import { createHash } from "node:crypto";
import {
  readdirSync,
  readFileSync,
  realpathSync,
  statfsSync,
  statSync,
} from "node:fs";
import { join, posix, relative } from "node:path";
import { gunzipSync } from "node:zlib";
import { isInside, record, sha256 } from "./contract.ts";

/** Categories describe Optique archive contents, not executed modules. */
export function classifyFile(
  path: string,
): "declarations" | "esm" | "cjs" | "other" {
  if (/\.d\.(ts|cts|mts)$/.test(path)) return "declarations";
  if (/\.(js|mjs)$/.test(path)) return "esm";
  return path.endsWith(".cjs") ? "cjs" : "other";
}

/** One regular file in a release tarball. */
export interface TarFile {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

/** Reads regular files from ustar/PAX archives; rejects unsupported entries. */
export function readTar(input: Uint8Array): readonly TarFile[] {
  const bytes = input[0] === 0x1f && input[1] === 0x8b
    ? gunzipSync(input)
    : Buffer.from(input);
  if (bytes.length < 1024 || bytes.length % 512 !== 0) {
    throw new TypeError("Malformed tar archive length.");
  }
  const files: TarFile[] = [];
  const seen = new Set<string>();
  let pax: Record<string, string> = {};
  let ended = false;
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      ended = true;
      break;
    }
    const field = (start: number, length: number) =>
      header.subarray(start, start + length).toString("utf8").replace(
        /\0.*$/s,
        "",
      );
    const numeric = (start: number, length: number) => {
      const text = field(start, length).trim();
      if (!/^[0-7]+$/.test(text)) {
        throw new TypeError("Invalid tar numeric field.");
      }
      const value = parseInt(text, 8);
      if (!Number.isSafeInteger(value)) {
        throw new TypeError("Oversized tar field.");
      }
      return value;
    };
    const expectedChecksum = numeric(148, 8);
    const checksum = header.reduce(
      (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
      0,
    );
    if (checksum !== expectedChecksum) {
      throw new TypeError("Invalid tar checksum.");
    }
    const type = field(156, 1);
    const size = numeric(124, 12);
    const content = bytes.subarray(offset + 512, offset + 512 + size);
    if (content.length !== size) throw new TypeError("Truncated tar archive.");
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") {
      pax = parsePax(content);
      continue;
    }
    if (type === "5") {
      pax = {};
      continue;
    }
    if (type !== "0" && type !== "") {
      throw new TypeError(`Unsupported tar entry type: ${type}`);
    }
    if (pax.size != null && Number(pax.size) !== size) {
      throw new TypeError("Unsupported PAX size mismatch.");
    }
    const prefix = field(345, 155);
    const name = pax.path ??
      `${prefix === "" ? "" : `${prefix}/`}${field(0, 100)}`;
    pax = {};
    if (
      !name.startsWith("package/") || name.includes("\\") ||
      posix.normalize(name) !== name || name.split("/").includes("..") ||
      seen.has(name)
    ) throw new TypeError(`Invalid tar package path: ${name}`);
    seen.add(name);
    const path = name.slice(8);
    files.push({ path, size, sha256: sha256(content), bytes: content });
  }
  if (!ended || files.length === 0) {
    throw new TypeError("Incomplete tar archive.");
  }
  return files.toSorted((a, b) => a.path.localeCompare(b.path, "en"));
}

function parsePax(bytes: Buffer): Record<string, string> {
  const result: Record<string, string> = {};
  for (let offset = 0; offset < bytes.length;) {
    const space = bytes.indexOf(32, offset);
    const length = Number(bytes.subarray(offset, space).toString());
    if (
      space < offset || !Number.isSafeInteger(length) || length < 4 ||
      offset + length > bytes.length
    ) throw new TypeError("Malformed PAX record.");
    const item = bytes.subarray(space + 1, offset + length - 1).toString(
      "utf8",
    );
    const equals = item.indexOf("=");
    if (equals < 1 || bytes[offset + length - 1] !== 10) {
      throw new TypeError("Malformed PAX field.");
    }
    result[item.slice(0, equals)] = item.slice(equals + 1);
    offset += length;
  }
  return result;
}

/** Path-deduplicated apparent bytes and allocated blocks in node_modules. */
export function inventoryTree(
  root: string,
  exclusions: readonly string[] = [],
) {
  const base = realpathSync(root);
  const visited = new Set<string>();
  const files: {
    path: string;
    size: number;
    allocatedBytes: number;
    sha256: string;
    links: number;
  }[] = [];
  const visit = (path: string) => {
    const real = realpathSync(path);
    if (!isInside(real, base)) {
      throw new TypeError(`Installed path escaped node_modules: ${path}`);
    }
    if (visited.has(real)) return;
    visited.add(real);
    const rel = relative(base, real).replaceAll("\\", "/");
    if (exclusions.includes(rel)) return;
    const info = statSync(real);
    if (info.isDirectory()) {
      for (const entry of readdirSync(real).sort()) visit(join(real, entry));
    } else if (info.isFile()) {
      files.push({
        path: rel,
        size: info.size,
        allocatedBytes: (info.blocks ?? 0) * 512,
        sha256: sha256(readFileSync(real)),
        links: info.nlink,
      });
    } else throw new TypeError(`Unsupported installed file: ${rel}`);
  };
  visit(base);
  return {
    files,
    apparentBytes: files.reduce((sum, file) => sum + file.size, 0),
    allocatedBytes: files.reduce((sum, file) => sum + file.allocatedBytes, 0),
    filesystemType: statfsSync(base).type,
  };
}

/** A harness-generated tarball identity used by every dependency override. */
export interface ArchiveReference {
  readonly name: string;
  readonly specifier: string;
  readonly integrity: string;
}

/** Checks every lock package, never accepting an unchecked registry entry. */
export function verifyLock(
  value: unknown,
  archives: readonly ArchiveReference[],
): void {
  const lock = record(value);
  const packages = record(lock.packages);
  const overrides = record(lock.overrides);
  if (Object.keys(packages).length !== archives.length) {
    throw new TypeError("Unexpected lock package count.");
  }
  for (const archive of archives) {
    if (overrides[archive.name] !== archive.specifier) {
      throw new TypeError(`Missing local override: ${archive.name}`);
    }
    const candidates = Object.entries(packages).filter(([key]) =>
      key.startsWith(`${archive.name}@`)
    );
    if (candidates.length !== 1) {
      throw new TypeError(`Missing or duplicate lock package: ${archive.name}`);
    }
    const resolution = record(record(candidates[0][1]).resolution);
    if (
      resolution.tarball !== archive.specifier ||
      resolution.integrity !== archive.integrity
    ) {
      throw new TypeError(
        `Wrong tarball resolution or integrity: ${archive.name}`,
      );
    }
  }
}

/** Computes the exact integrity field recorded by pnpm. */
export function archiveIntegrity(bytes: Uint8Array): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

/** Rejects installed byte/path drift before accepting prepared measurements. */
export function verifyInventory(
  actual: ReturnType<typeof inventoryTree>,
  expected: unknown,
): void {
  const snapshot = record(expected);
  if (!Array.isArray(snapshot.files)) {
    throw new TypeError("Invalid prepared installation inventory.");
  }
  const signature = (files: readonly unknown[]) =>
    JSON.stringify(
      files.map((value) => {
        const file = record(value);
        return {
          path: file.path,
          size: file.size,
          sha256: file.sha256,
          links: file.links,
        };
      }).sort((a, b) => String(a.path).localeCompare(String(b.path), "en")),
    );
  if (signature(actual.files) !== signature(snapshot.files)) {
    throw new TypeError(
      "Prepared installation contents changed; prepare again.",
    );
  }
}

/** Cross-checks the independent pack inventory against parsed archive paths. */
export function verifyPackList(value: unknown, paths: readonly string[]): void {
  const pack = record(value);
  if (!Array.isArray(pack.files)) {
    throw new TypeError("Missing pnpm pack file inventory.");
  }
  const expected = pack.files.map((value) => {
    const item = record(value);
    if (typeof item.path !== "string") {
      throw new TypeError("Invalid pnpm pack file inventory.");
    }
    return item.path;
  });
  if (JSON.stringify(expected.sort()) !== JSON.stringify([...paths].sort())) {
    throw new TypeError("pnpm pack and archive file lists disagree.");
  }
}
