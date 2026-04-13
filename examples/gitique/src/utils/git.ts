import {
  type Commit,
  createSignature,
  openRepository,
  type Repository,
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
    const pattern = filePath === "."
      ? "*"
      : toRepoRelativePath(repo, filePath) + "/**";
    index.addAll([pattern], force ? { force: true } : undefined);
  } else if (force) {
    // addPath has no force option; route through addAll instead
    const repoRelativePath = toRepoRelativePath(repo, filePath);
    index.addAll([repoRelativePath], { force: true });
  } else {
    const repoRelativePath = toRepoRelativePath(repo, filePath);
    index.addPath(repoRelativePath);
  }
  index.write();
}

/**
 * Adds all files to the Git index (equivalent to `git add .`).
 */
export function addAllFiles(repo: Repository, force?: boolean): void {
  const index = repo.index();
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
 * Gets the commit history starting from HEAD.
 */
export function getCommitHistory(
  repo: Repository,
  maxCount?: number,
): CommitWithOid[] {
  const commits: CommitWithOid[] = [];

  try {
    const revwalk = repo.revwalk().pushHead();

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
 * Resets the index to match HEAD (unstages all changes).
 */
export function resetIndex(repo: Repository): void {
  try {
    const index = repo.index();

    // Remove all files from index using removeAll with wildcard
    // This effectively clears the index
    index.removeAll(["*"]);
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
    for (const delta of stagedDiff.deltas()) {
      const path = delta.newFile().path();
      if (path === null) continue;

      results.push({
        path,
        status: delta.status() as FileStatus["status"],
        oldPath: delta.status() === "Renamed"
          ? (delta.oldFile().path() ?? undefined)
          : undefined,
        staged: true,
      });
    }

    // Unstaged changes: compare index to working directory.
    // includeUntracked: true ensures untracked files are shown,
    // which is required both in normal repos and in unborn repos
    // where no HEAD exists yet.
    const unstagedDiff = repo.diffIndexToWorkdir(undefined, {
      includeUntracked: true,
    });
    for (const delta of unstagedDiff.deltas()) {
      const path = delta.newFile().path();
      if (path === null) continue;

      // Skip if already reported as staged (avoid duplicates for files
      // that have both staged and unstaged changes)
      const alreadyStaged = results.some(
        (r) => r.path === path && r.staged,
      );
      if (alreadyStaged) continue;

      results.push({
        path,
        status: delta.status() as FileStatus["status"],
        oldPath: delta.status() === "Renamed"
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
      // Staged changes only: compare HEAD tree to index tree.
      // Using diffTreeToWorkdirWithIndex would blend in unstaged changes.
      // When on an unborn branch (no HEAD yet) treat as empty old tree.
      let headTree;
      try {
        headTree = repo.head().peelToTree();
      } catch {
        // No HEAD yet (unborn repository) — diff against empty tree
      }
      const index = repo.index();
      const indexTreeOid = index.writeTree();
      const indexTree = repo.getTree(indexTreeOid);
      diff = repo.diffTreeToTree(headTree, indexTree, esDiffOptions);
    } else if (options.commit && options.commit2) {
      // Compare two specific commits
      const tree1 = repo.getCommit(options.commit).tree();
      const tree2 = repo.getCommit(options.commit2).tree();
      diff = repo.diffTreeToTree(tree1, tree2, esDiffOptions);
    } else if (options.commit) {
      // Compare with specific commit
      const commitObj = repo.getCommit(options.commit);
      const commitTree = commitObj.tree();
      diff = repo.diffTreeToWorkdirWithIndex(commitTree, esDiffOptions);
    } else {
      // Unstaged changes: index vs workdir
      diff = repo.diffIndexToWorkdir(undefined, esDiffOptions);
    }

    const stats = diff.stats();
    const deltas: DiffResult["deltas"] = [];

    for (const delta of diff.deltas()) {
      const path = delta.newFile().path();
      if (path === null) continue;

      deltas.push({
        path,
        oldPath: delta.status() === "Renamed"
          ? (delta.oldFile().path() ?? undefined)
          : undefined,
        status: delta.status(),
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
