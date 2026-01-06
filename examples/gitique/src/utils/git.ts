import {
  type Commit,
  createSignature,
  openRepository,
  type Repository,
  type Signature,
} from "es-git";
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
): void {
  const index = repo.index();
  const repoRelativePath = toRepoRelativePath(repo, filePath);
  index.addPath(repoRelativePath);
  index.write();
}

/**
 * Adds all files to the Git index (equivalent to `git add .`).
 */
export function addAllFiles(repo: Repository): void {
  const index = repo.index();
  index.addAll(["*"]);
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
      // No HEAD exists (empty repository)
    }

    // Get all changes (staged + unstaged) using diffTreeToWorkdirWithIndex
    // This compares HEAD tree to working directory with index
    if (headTree) {
      const diff = repo.diffTreeToWorkdirWithIndex(headTree);
      for (const delta of diff.deltas()) {
        const path = delta.newFile().path();
        if (path === null) continue;

        results.push({
          path,
          status: delta.status() as FileStatus["status"],
          oldPath: delta.status() === "Renamed"
            ? (delta.oldFile().path() ?? undefined)
            : undefined,
          staged: false, // We can't distinguish staged/unstaged with this method
        });
      }
    } else {
      // For empty repository, get unstaged changes only
      const unstagedDiff = repo.diffIndexToWorkdir();
      for (const delta of unstagedDiff.deltas()) {
        const path = delta.newFile().path();
        if (path === null) continue;

        results.push({
          path,
          status: delta.status() as FileStatus["status"],
          oldPath: delta.status() === "Renamed"
            ? (delta.oldFile().path() ?? undefined)
            : undefined,
          staged: false,
        });
      }
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
  paths?: string[];
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

    if (options.cached) {
      // Staged changes: compare HEAD tree to workdir with index
      // This shows what would be committed
      const headTree = repo.head().peelToTree();
      diff = repo.diffTreeToWorkdirWithIndex(headTree);
    } else if (options.commit) {
      // Compare with specific commit
      const commitObj = repo.getCommit(options.commit);
      const commitTree = commitObj.tree();
      diff = repo.diffTreeToWorkdirWithIndex(commitTree);
    } else {
      // Unstaged changes: index vs workdir
      diff = repo.diffIndexToWorkdir();
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
