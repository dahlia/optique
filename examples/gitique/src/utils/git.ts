import {
  type Commit,
  createSignature,
  openConfig,
  openDefaultConfig,
  openRepository,
  type Repository,
  RevwalkSort,
  type Signature,
} from "es-git";
import { lstatSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import process from "node:process";

interface CommitWithOid {
  oid: string;
  commit: Commit;
}

/**
 * Opens the Git repository in the current working directory.
 * Throws an error if not in a Git repository.
 */
export async function getRepository(): Promise<Repository> {
  try {
    return await openRepository(".");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Not a git repository (or any of the parent directories): .git (${detail}).`,
    );
  }
}

/**
 * Creates a signature for commits using Git configuration or provided values.
 * When name/email are not provided, reads user.name and user.email from
 * the repo-local config first, then from the default (global/XDG/system) config.
 */
export function createGitSignature(
  name?: string,
  email?: string,
  repo?: Repository,
): Signature {
  let authorName = name;
  let authorEmail = email;

  if (!authorName || !authorEmail) {
    // Try local repo config first, then the default cascade.
    const configSources: Array<() => void> = [];
    if (repo) {
      configSources.push(() => {
        try {
          const localConfig = openConfig(resolve(repo.path(), "config"));
          if (!authorName) {
            try {
              authorName = localConfig.getString("user.name");
            } catch {
              // Key not set in local config
            }
          }
          if (!authorEmail) {
            try {
              authorEmail = localConfig.getString("user.email");
            } catch {
              // Key not set in local config
            }
          }
        } catch {
          // Local config file unavailable
        }
      });
    }
    configSources.push(() => {
      try {
        const defaultConfig = openDefaultConfig();
        if (!authorName) {
          try {
            authorName = defaultConfig.getString("user.name");
          } catch {
            // Key not set in global config
          }
        }
        if (!authorEmail) {
          try {
            authorEmail = defaultConfig.getString("user.email");
          } catch {
            // Key not set in global config
          }
        }
      } catch {
        // Default config unavailable
      }
    });

    for (const tryConfig of configSources) {
      tryConfig();
      if (authorName && authorEmail) break;
    }
  }

  if (!authorName || !authorEmail) {
    const missing = [
      !authorName && "user.name",
      !authorEmail && "user.email",
    ].filter(Boolean).join(" and ");
    const commands = [
      !authorName && `  git config --global user.name "Your Name"`,
      !authorEmail && `  git config --global user.email "you@example.com"`,
    ].filter(Boolean).join("\n");
    throw new Error(
      `Please tell me who you are.\n\n` +
        `Run\n\n` +
        `${commands}\n\n` +
        `to set your account's default identity.\n\n` +
        `Cannot read ${missing} from git config.`,
    );
  }

  return createSignature(authorName, authorEmail);
}

/**
 * Converts a file path to be relative to the repository root.
 */
function toRepoRelativePath(repo: Repository, filePath: string): string {
  // Strip the trailing /.git/ or \.git\ (Windows) from the repo path.
  const repoRoot = repo.path().replace(/[/\\]?\.git[/\\]?$/, "");
  const absolutePath = resolve(process.cwd(), filePath);
  // Normalize to forward slashes — libgit2/es-git expects POSIX separators.
  return relative(repoRoot, absolutePath).replace(/\\/g, "/");
}

/**
 * Adds a single file to the Git index.
 */
export function addFile(
  repo: Repository,
  filePath: string,
  force?: boolean,
): void {
  const index = repo.index();
  const absolutePath = resolve(process.cwd(), filePath);

  // When the path is "." or an existing directory, use addAll with a
  // glob pattern so libgit2 can enumerate the contents recursively.
  // For individual files with --force, also use addAll because addPath
  // has no force option.
  let isDirectory = filePath === ".";
  if (!isDirectory) {
    try {
      isDirectory = lstatSync(absolutePath).isDirectory();
    } catch {
      // Path doesn't exist — let addPath handle the error
    }
  }

  if (isDirectory) {
    // Convert "." to the repo-relative path of the current directory so that
    // `gitique add .` from a subdirectory stages only that subtree, not the
    // whole repository.
    const repoRelDir = toRepoRelativePath(repo, filePath);
    // An empty string means the cwd is the repo root — use "*" to match all
    const pattern = repoRelDir === "" ? "*" : repoRelDir + "/**";
    // updateAll first to stage deletions of tracked files, then addAll for
    // new and modified files.
    index.updateAll([pattern]);
    index.addAll([pattern], force ? { force: true } : undefined);
  } else if (force) {
    // addPath has no force option; route through addAll instead.
    // Also call updateAll first so that a tracked file that was deleted
    // from the worktree has its deletion staged even under --force.
    const repoRelativePath = toRepoRelativePath(repo, filePath);
    // Validate that the path exists on disk or is already tracked in HEAD
    // so that --force on a completely unknown path still errors.
    const existsOnDisk = (() => {
      try {
        lstatSync(absolutePath);
        return true;
      } catch {
        return false;
      }
    })();
    if (!existsOnDisk) {
      let trackedInHead = false;
      try {
        const headTree = repo.head().peelToTree();
        trackedInHead = headTree.getPath(repoRelativePath) !== null;
      } catch {
        // Unborn repository
      }
      // Also allow a file that is staged but not yet committed (in index but
      // not in HEAD) — staging its deletion is valid even under --force.
      const inIndex = index.getByPath(repoRelativePath) !== null;
      if (!trackedInHead && !inIndex) {
        throw new Error(
          `pathspec '${filePath}' did not match any files.`,
        );
      }
    }
    index.updateAll([repoRelativePath]);
    index.addAll([repoRelativePath], { force: true });
  } else {
    const repoRelativePath = toRepoRelativePath(repo, filePath);
    try {
      index.addPath(repoRelativePath);
    } catch (err) {
      // addPath requires the file to exist in the working tree.
      // For tracked files deleted from the worktree, fall back to
      // updateAll to stage the deletion.  For completely unknown paths
      // (not in HEAD and not on disk), rethrow the original error.
      let trackedInHead = false;
      try {
        const headTree = repo.head().peelToTree();
        trackedInHead = headTree.getPath(repoRelativePath) !== null;
      } catch {
        // Unborn repository — nothing in HEAD
      }
      // Also handle a staged-but-not-committed file deleted from disk:
      // it's not in HEAD but IS in the index, and staging the deletion is valid.
      const inIndex = index.getByPath(repoRelativePath) !== null;
      if (trackedInHead || inIndex) {
        index.updateAll([repoRelativePath]);
      } else {
        throw err;
      }
    }
  }
  index.write();
}

/**
 * Adds all files to the Git index (equivalent to `git add .`).
 */
export function addAllFiles(repo: Repository, force?: boolean): void {
  const index = repo.index();
  // updateAll stages removals of tracked files (paths deleted from workdir)
  index.updateAll(["*"]);
  // addAll stages new and modified files; force bypasses gitignore
  index.addAll(["*"], force ? { force: true } : undefined);
  index.write();
}

/**
 * Stages only tracked (already-indexed) files, equivalent to `git add -u`.
 * Untracked files are left unstaged, matching `git commit -a` semantics.
 */
export function stageTrackedFiles(repo: Repository): void {
  const index = repo.index();
  index.updateAll(["*"]);
  index.write();
}

/**
 * Creates a commit with the current index state.
 */
export function createCommit(
  repo: Repository,
  message: string,
  author?: Signature,
  committer?: Signature,
): string {
  const index = repo.index();
  const treeOid = index.writeTree();
  const tree = repo.getTree(treeOid);

  const actualAuthor = author ?? createGitSignature();
  const actualCommitter = committer ?? actualAuthor;

  // Get current HEAD as parent (if exists)
  let parents: string[] = [];
  try {
    const headTarget = repo.head().target();
    if (headTarget) {
      parents = [headTarget];
    }
  } catch {
    // No HEAD exists (first commit)
  }

  return repo.commit(tree, message, {
    updateRef: "HEAD",
    author: actualAuthor,
    committer: actualCommitter,
    parents,
  });
}

/**
 * Returns true when the index matches HEAD (nothing staged to commit).
 * In an unborn repository the index is empty when it has no entries.
 */
export function isIndexEmpty(repo: Repository): boolean {
  const index = repo.index();
  const indexTreeOid = index.writeTree();
  const indexTree = repo.getTree(indexTreeOid);

  let headTree;
  try {
    headTree = repo.head().peelToTree();
  } catch {
    // Unborn repository — index is non-empty when the tree has any entries
    return indexTree.isEmpty();
  }

  const diff = repo.diffTreeToTree(headTree, indexTree);
  // Deltas is an iterable with no length property; check for any delta
  for (const _ of diff.deltas()) {
    return false;
  }
  return true;
}

/**
 * Resolves a commit-ish spec (e.g. "HEAD", "HEAD~1", an OID, a tag name) to
 * the OID of the underlying commit.  Peels through annotated tags so that
 * tag references can be used wherever commit OIDs are expected.
 *
 * @throws If the spec cannot be resolved or does not point to a commit.
 */
export function resolveCommitOid(repo: Repository, spec: string): string {
  const oid = repo.revparseSingle(spec);
  const obj = repo.findObject(oid);
  if (!obj) throw new Error(`Failed to find object for '${spec}'.`);
  return obj.peelToCommit().id();
}

/**
 * Moves HEAD (and the current branch pointer) to the given commit OID.
 * When HEAD is a symbolic reference the branch pointer is updated;
 * otherwise (detached HEAD) setHeadDetached is used.
 *
 * libgit2 (and thus es-git) rejects createBranch(..., { force: true })
 * when the branch is currently checked out.  The workaround is to
 * temporarily detach HEAD so that the branch reference is no longer
 * "in use", update the branch, then re-attach HEAD.
 */
export function moveHead(repo: Repository, targetOid: string): void {
  const obj = repo.findObject(targetOid);
  if (!obj) throw new Error(`Failed to find object: ${targetOid}`);
  const commit = obj.peelToCommit();

  // repo.headDetached() returns true for detached HEAD and false when HEAD
  // points to a branch.  repo.head() resolves the ref so symbolicTarget()
  // is always null there — use headDetached() to distinguish the two cases.
  if (!repo.headDetached()) {
    // Try to resolve the branch name from the resolved ref first; fall back
    // to reading .git/HEAD directly for unborn branches where repo.head()
    // throws because the branch ref doesn't exist yet.
    let branchName: string | null = null;
    try {
      branchName = repo.head().name().replace(/^refs\/heads\//, "");
    } catch {
      // Unborn branch — read the symbolic target from .git/HEAD
      try {
        const headContent = readFileSync(resolve(repo.path(), "HEAD"), "utf-8")
          .trim();
        if (headContent.startsWith("ref: refs/heads/")) {
          branchName = headContent.slice("ref: refs/heads/".length);
        }
      } catch {
        // Unable to read HEAD
      }
    }
    if (branchName) {
      // Detach HEAD first to lift the "branch is checked out" restriction,
      // then update the branch reference, then re-attach HEAD.
      repo.setHeadDetached(commit);
      repo.createBranch(branchName, commit, { force: true });
      repo.setHead(`refs/heads/${branchName}`);
      return;
    }
  }
  repo.setHeadDetached(commit);
}

/**
 * Gets the commit history starting from HEAD.
 */
export function getCommitHistory(
  repo: Repository,
  maxCount?: number,
): CommitWithOid[] {
  const commits: CommitWithOid[] = [];

  try {
    const revwalk = repo.revwalk().setSorting(RevwalkSort.Time).pushHead();

    let count = 0;
    for (const oid of revwalk) {
      if (maxCount && count >= maxCount) break;

      const commit = repo.getCommit(oid);
      commits.push({ oid, commit });
      count++;
    }
  } catch (error) {
    // An unborn repository has no HEAD — treat it as empty history.
    // Rethrow any other unexpected error.
    const msg = error instanceof Error ? error.message : String(error);
    if (
      !msg.includes("reference") &&
      !msg.includes("HEAD") &&
      !msg.includes("unborn")
    ) {
      throw error;
    }
  }

  return commits;
}

/**
 * Unstages a single file by reverting the index entry to match HEAD.
 * For tracked files, the HEAD version is restored in the index (the
 * working tree is not touched).  For files that are new in the index
 * (not in HEAD), the entry is removed from the index entirely.
 */
export function unstageFile(repo: Repository, filePath: string): void {
  const index = repo.index();
  // All index operations require repo-root-relative paths
  const repoRelativePath = toRepoRelativePath(repo, filePath);

  // Check whether the file exists in HEAD
  let inHead = false;
  try {
    const headTree = repo.head().peelToTree();
    inHead = headTree.getPath(repoRelativePath) !== null;
  } catch {
    // Unborn repository — nothing in HEAD
  }

  // Verify the path is known to at least one of HEAD or the index before
  // proceeding; an entirely unknown path should be an error, not a no-op.
  const inIndex = index.getByPath(repoRelativePath) !== null;
  if (!inHead && !inIndex) {
    throw new Error(`pathspec '${filePath}' did not match any files.`);
  }

  // Remove the staged version from the index.  Without a readTree API in
  // es-git, we cannot restore the exact HEAD blob; removing the entry and
  // re-reading from disk is the closest approximation available.
  // - For a new file (not in HEAD): removal correctly unstages it.
  // - For a modified tracked file: removal leaves the file untracked in
  //   the index view, which is an imperfect approximation.
  index.removeAll([repoRelativePath]);
  if (inHead) {
    // Re-read from disk so the file stays tracked rather than appearing
    // as a staged deletion; this is an approximation of HEAD restoration.
    try {
      index.addPath(repoRelativePath);
    } catch {
      // File was deleted from the working tree — leave the staged deletion
    }
  }
  index.write();
}

/**
 * Resets the index to match HEAD (unstages all changes).
 *
 * Note: es-git does not expose `git_index_read_tree`, so we cannot
 * restore index entries from an arbitrary commit tree.  As an
 * approximation, reload the on-disk index (which reflects the last
 * commit) and then synchronize tracked entries with the working
 * tree.  This correctly unstages modifications but may leave deleted
 * tracked files as staged removals until the next hard reset.
 */
export function resetIndex(repo: Repository): void {
  try {
    const index = repo.index();
    // Reload the index from disk to drop in-memory staged changes
    index.read(true);
    // Re-synchronize tracked entries with the working tree so that
    // existing modifications in the workdir are reflected correctly
    index.updateAll(["*"]);
    index.write();
  } catch (error) {
    throw new Error(
      `Failed to reset index: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Checks out HEAD, updating the working directory to match.
 * Wraps es-git's repo.checkoutHead() to keep all es-git calls
 * in the shared utility layer rather than in command handlers.
 */
export function checkoutHead(
  repo: Repository,
  options?: { force?: boolean },
): void {
  repo.checkoutHead(options);
}

/**
 * Represents a file's status in the working directory.
 */
export interface FileStatus {
  path: string;
  status:
    | "Added"
    | "Deleted"
    | "Modified"
    | "Renamed"
    | "Copied"
    | "Untracked"
    | "Typechange"
    | "Conflicted";
  oldPath?: string;
  staged: boolean;
}

/**
 * Gets the status of files in the working directory.
 * Returns both staged and unstaged changes.
 */
export function getStatus(repo: Repository): FileStatus[] {
  const results: FileStatus[] = [];

  try {
    // Get HEAD tree for comparison
    let headTree = null;
    try {
      headTree = repo.head().peelToTree();
    } catch {
      // No HEAD exists (unborn repository)
    }

    // Staged changes: compare HEAD tree (or empty) to the index.
    // index.writeTree() fails when the index contains unresolved merge
    // conflicts (unmerged entries).  In that case we skip the staged diff
    // entirely rather than crashing — the unstaged diff below will still
    // show the conflicted files.
    const index = repo.index();
    let indexTreeOid: string | null = null;
    try {
      indexTreeOid = index.writeTree();
    } catch {
      // Unmerged entries prevent writing the tree; skip staged diff
    }

    if (indexTreeOid !== null) {
      const indexTree = repo.getTree(indexTreeOid);
      const stagedDiff = repo.diffTreeToTree(
        headTree ?? undefined,
        indexTree,
      );
      stagedDiff.findSimilar();
      for (const delta of stagedDiff.deltas()) {
        // Deleted deltas have no newFile path; use oldFile path instead.
        const status = delta.status() as FileStatus["status"];
        const path = delta.newFile().path() ?? delta.oldFile().path();
        if (path === null) continue;

        results.push({
          path,
          status,
          oldPath: (status === "Renamed" || status === "Copied")
            ? (delta.oldFile().path() ?? undefined)
            : undefined,
          staged: true,
        });
      }
    }

    // Unstaged changes: compare index to working directory.
    // includeUntracked: true ensures untracked files are shown,
    // which is required both in normal repos and in unborn repos
    // where no HEAD exists yet.
    // A file that has both staged and unstaged changes is intentionally
    // reported twice (once per state) so callers can show dual-state
    // output like "MM" or "AM".
    const unstagedDiff = repo.diffIndexToWorkdir(undefined, {
      includeUntracked: true,
    });
    unstagedDiff.findSimilar();
    for (const delta of unstagedDiff.deltas()) {
      // Deleted deltas have no newFile path; use oldFile path instead.
      const status = delta.status() as FileStatus["status"];
      const path = delta.newFile().path() ?? delta.oldFile().path();
      if (path === null) continue;

      results.push({
        path,
        status,
        oldPath: (status === "Renamed" || status === "Copied")
          ? (delta.oldFile().path() ?? undefined)
          : undefined,
        staged: false,
      });
    }
  } catch (error) {
    throw new Error(
      `Failed to get status: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return results;
}

/**
 * Options for the getDiff function.
 */
export interface DiffOptions {
  cached?: boolean;
  commit?: string;
  commit2?: string;
  paths?: string[];
  unified?: number;
  algorithm?: "default" | "minimal" | "patience";
}

/**
 * Result of a diff operation.
 */
export interface DiffResult {
  text: string;
  stats: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
  deltas: Array<{
    path: string;
    oldPath?: string;
    status: string;
  }>;
}

/**
 * Gets the diff of changes in the repository.
 */
export function getDiff(
  repo: Repository,
  options: DiffOptions = {},
): DiffResult {
  if (options.cached && options.commit2) {
    throw new Error(
      "--cached compares the index to a base tree; " +
        "specifying two commits is not supported with --cached.",
    );
  }

  try {
    let diff;

    // Build es-git diff options from our options
    const esDiffOptions: {
      contextLines?: number;
      patience?: boolean;
      minimal?: boolean;
      pathspecs?: string[];
    } = {};
    if (options.unified !== undefined) {
      esDiffOptions.contextLines = options.unified;
    }
    if (options.algorithm === "patience") {
      esDiffOptions.patience = true;
    } else if (options.algorithm === "minimal") {
      esDiffOptions.minimal = true;
    }
    // "default" uses default es-git behaviour
    if (options.paths && options.paths.length > 0) {
      esDiffOptions.pathspecs = options.paths;
    }

    if (options.cached) {
      // Staged changes only: compare a base tree to the index tree.
      // The base is options.commit when provided (e.g. diff --cached HEAD~1),
      // otherwise HEAD.  Unborn repos fall back to an empty tree.
      let baseTree;
      if (options.commit) {
        // Explicit commit argument — let revspec errors propagate to the caller.
        // Peel through annotated tags to get the actual commit tree.
        const baseOid = repo.revparseSingle(options.commit);
        const baseObj = repo.findObject(baseOid);
        if (!baseObj) {
          throw new Error(`Object not found for '${options.commit}'.`);
        }
        baseTree = baseObj.peelToCommit().tree();
      } else {
        try {
          baseTree = repo.head().peelToTree();
        } catch {
          // No HEAD yet (unborn repository) — diff against empty tree
        }
      }
      const index = repo.index();
      const indexTreeOid = index.writeTree();
      const indexTree = repo.getTree(indexTreeOid);
      diff = repo.diffTreeToTree(baseTree, indexTree, esDiffOptions);
    } else if (options.commit && options.commit2) {
      // Compare two specific commits; peel through annotated tags so that
      // tag refs like 'v1.0' work alongside branch names and OIDs.
      const oid1 = repo.revparseSingle(options.commit);
      const oid2 = repo.revparseSingle(options.commit2);
      const obj1 = repo.findObject(oid1);
      const obj2 = repo.findObject(oid2);
      if (!obj1) throw new Error(`Object not found for '${options.commit}'.`);
      if (!obj2) throw new Error(`Object not found for '${options.commit2}'.`);
      const tree1 = obj1.peelToCommit().tree();
      const tree2 = obj2.peelToCommit().tree();
      diff = repo.diffTreeToTree(tree1, tree2, esDiffOptions);
    } else if (options.commit) {
      // Compare with specific commit; peel through annotated tags.
      const oid = repo.revparseSingle(options.commit);
      const obj = repo.findObject(oid);
      if (!obj) throw new Error(`Object not found for '${options.commit}'.`);
      const commitTree = obj.peelToCommit().tree();
      diff = repo.diffTreeToWorkdirWithIndex(commitTree, esDiffOptions);
    } else {
      // Unstaged changes: index vs workdir
      diff = repo.diffIndexToWorkdir(undefined, esDiffOptions);
    }

    // Enable rename and copy detection.
    diff.findSimilar();

    const stats = diff.stats();
    const deltas: DiffResult["deltas"] = [];

    for (const delta of diff.deltas()) {
      // Deleted deltas have no newFile path; use oldFile path instead.
      const status = delta.status();
      const path = delta.newFile().path() ?? delta.oldFile().path();
      if (path === null) continue;

      deltas.push({
        path,
        oldPath: (status === "Renamed" || status === "Copied")
          ? (delta.oldFile().path() ?? undefined)
          : undefined,
        status,
      });
    }

    return {
      text: diff.print(),
      stats: {
        filesChanged: Number(stats.filesChanged),
        insertions: Number(stats.insertions),
        deletions: Number(stats.deletions),
      },
      deltas,
    };
  } catch (error) {
    throw new Error(
      `Failed to get diff: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
