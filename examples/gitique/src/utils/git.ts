import {
  type Commit,
  createSignature,
  openRepository,
  type Repository,
  RevwalkSort,
  type Signature,
} from "es-git";
import { statSync } from "node:fs";
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
  } catch (_error) {
    throw new Error(
      "Not a git repository (or any of the parent directories): .git",
    );
  }
}

/**
 * Creates a signature for commits using Git configuration or provided values.
 */
export function createGitSignature(
  name?: string,
  email?: string,
): Signature {
  // In a real implementation, we would read from git config
  // For this example, we'll use defaults or provided values
  const authorName = name ?? "Gitique User";
  const authorEmail = email ?? "gitique@example.com";

  return createSignature(authorName, authorEmail);
}

/**
 * Converts a file path to be relative to the repository root.
 */
function toRepoRelativePath(repo: Repository, filePath: string): string {
  const repoRoot = repo.path().replace(/\.git\/?$/, "");
  const absolutePath = resolve(process.cwd(), filePath);
  return relative(repoRoot, absolutePath);
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
      isDirectory = statSync(absolutePath).isDirectory();
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
    // addPath has no force option; route through addAll instead
    const repoRelativePath = toRepoRelativePath(repo, filePath);
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
      if (trackedInHead) {
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
 * Resolves a commit-ish spec (e.g. "HEAD", "HEAD~1", an OID) to a full OID.
 *
 * @throws If the spec cannot be resolved.
 */
export function resolveCommitOid(repo: Repository, spec: string): string {
  return repo.revparseSingle(spec);
}

/**
 * Moves HEAD (and the current branch pointer) to the given commit OID.
 * When HEAD is a symbolic reference the branch pointer is updated via
 * createBranch; otherwise (detached HEAD) setHeadDetached is used.
 */
export function moveHead(repo: Repository, targetOid: string): void {
  const commit = repo.getCommit(targetOid);

  // repo.headDetached() returns true for detached HEAD and false when HEAD
  // points to a branch.  repo.head() resolves the ref so symbolicTarget()
  // is always null there — use headDetached() to distinguish the two cases.
  if (!repo.headDetached()) {
    try {
      const head = repo.head();
      const branchName = head.name().replace(/^refs\/heads\//, "");
      repo.createBranch(branchName, commit, { force: true });
      return;
    } catch {
      // Fall through to detached-HEAD path (e.g., unborn branch)
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
  } catch (_error) {
    // No commits yet or other error - this is normal for empty repositories
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
 * Represents a file's status in the working directory.
 */
export interface FileStatus {
  path: string;
  status: "Added" | "Deleted" | "Modified" | "Renamed" | "Copied" | "Untracked";
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

    // Staged changes: compare HEAD tree (or empty) to the index
    const index = repo.index();
    const indexTreeOid = index.writeTree();
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
        oldPath: status === "Renamed"
          ? (delta.oldFile().path() ?? undefined)
          : undefined,
        staged: true,
      });
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
        oldPath: status === "Renamed"
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
  algorithm?: "default" | "minimal" | "patience" | "histogram";
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
    // "histogram" and "default" use default es-git behaviour
    if (options.paths && options.paths.length > 0) {
      esDiffOptions.pathspecs = options.paths;
    }

    if (options.cached) {
      // Staged changes only: compare a base tree to the index tree.
      // The base is options.commit when provided (e.g. diff --cached HEAD~1),
      // otherwise HEAD.  Unborn repos fall back to an empty tree.
      let baseTree;
      try {
        if (options.commit) {
          const baseOid = repo.revparseSingle(options.commit);
          baseTree = repo.getCommit(baseOid).tree();
        } else {
          baseTree = repo.head().peelToTree();
        }
      } catch {
        // No HEAD yet (unborn repository) — diff against empty tree
      }
      const index = repo.index();
      const indexTreeOid = index.writeTree();
      const indexTree = repo.getTree(indexTreeOid);
      diff = repo.diffTreeToTree(baseTree, indexTree, esDiffOptions);
    } else if (options.commit && options.commit2) {
      // Compare two specific commits; resolve revspecs first so names like
      // HEAD, HEAD~1, and branch names work (getCommit expects raw OIDs).
      const oid1 = repo.revparseSingle(options.commit);
      const oid2 = repo.revparseSingle(options.commit2);
      const tree1 = repo.getCommit(oid1).tree();
      const tree2 = repo.getCommit(oid2).tree();
      diff = repo.diffTreeToTree(tree1, tree2, esDiffOptions);
    } else if (options.commit) {
      // Compare with specific commit; resolve revspec first
      const oid = repo.revparseSingle(options.commit);
      const commitObj = repo.getCommit(oid);
      const commitTree = commitObj.tree();
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
        oldPath: status === "Renamed"
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
