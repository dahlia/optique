import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";

const prefix = "optique-startup-consumers-";
const temporaryRoots = [...new Set([tmpdir(), "/var/tmp"])].filter(existsSync)
  .map((path) => realpathSync(path));

/**
 * Rejects package search paths that can supply undeclared dependencies.
 * @param root The shared parent of the measured consumers.
 * @throws {TypeError} If a package search ancestor contains node_modules.
 */
export function verifyConsumerAncestors(root: string): void {
  for (let path = realpathSync(root);; path = dirname(path)) {
    if (existsSync(join(path, "node_modules"))) {
      throw new TypeError(`Consumer ancestor contains node_modules: ${path}`);
    }
    if (dirname(path) === path) break;
  }
}

/**
 * Allocates consumers outside the checkout and records their owned location.
 * @param work The harness-owned local preparation directory.
 * @returns The owned external directory for consumers and tarball copies.
 * @throws {TypeError} If no temporary root has clean package search ancestors.
 */
export function createConsumerRoot(work: string): string {
  mkdirSync(work, { recursive: true });
  const base = temporaryRoots.find((path) => {
    try {
      verifyConsumerAncestors(path);
      return true;
    } catch {
      return false;
    }
  });
  if (base == null) {
    throw new TypeError("No temporary root without node_modules ancestors.");
  }
  const root = mkdtempSync(join(base, prefix));
  try {
    verifyConsumerAncestors(root);
    writeFileSync(join(root, ".owned"), realpathSync(work));
    writeFileSync(join(work, "consumer-root.json"), JSON.stringify(root));
    return root;
  } catch (error) {
    rmSync(root, { recursive: true });
    throw error;
  }
}

/**
 * Reads a preparation's consumer location after checking its ownership.
 * @param work The harness-owned local preparation directory.
 * @returns The verified external consumer directory.
 * @throws {TypeError} If the location or ownership marker is invalid.
 */
export function consumerRoot(work: string): string {
  const root = recordedConsumerRoot(work);
  if (!existsSync(root)) {
    throw new TypeError(
      "Consumer directory is missing; run benchmark:prepare again.",
    );
  }
  if (
    realpathSync(root) !== root ||
    readFileSync(join(root, ".owned"), "utf8") !== realpathSync(work)
  ) throw new TypeError("Invalid consumer directory ownership.");
  return root;
}

function recordedConsumerRoot(work: string): string {
  const root: unknown = JSON.parse(
    readFileSync(join(work, "consumer-root.json"), "utf8"),
  );
  if (
    typeof root !== "string" || !basename(root).startsWith(prefix) ||
    !temporaryRoots.includes(dirname(root))
  ) throw new TypeError("Invalid consumer directory ownership.");
  return root;
}

/**
 * Removes only the external directory owned by this preparation.
 * @param work The harness-owned local preparation directory.
 * @throws {TypeError} If the recorded location is not owned by this preparation.
 */
export function removeConsumerRoot(work: string): void {
  if (existsSync(join(work, "consumer-root.json"))) {
    const root = recordedConsumerRoot(work);
    if (existsSync(root)) rmSync(consumerRoot(work), { recursive: true });
    rmSync(join(work, "consumer-root.json"));
  }
}
