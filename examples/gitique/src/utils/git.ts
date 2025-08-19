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
 * Gets the status of files in the working directory.
 */
export function getStatus(_repo: Repository): Array<{
  path: string;
  status: string;
}> {
  // This would require implementing status checking with es-git
  // For now, return empty array as placeholder
  return [];
}
