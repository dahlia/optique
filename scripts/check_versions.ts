import { glob, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import workspaceMetadata from "../deno.json" with { type: "json" };
import coreMetadata from "../packages/core/deno.json" with { type: "json" };

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: node scripts/check_versions.ts [--help|-h] [--fix|-f]");
  console.log("Checks that all workspace members have the same version.");
  console.log(
    "If --fix or -f is provided, it will attempt to fix version mismatches.",
  );
  process.exit(0);
}

const workspaceMembers = workspaceMetadata.workspace;
const fix = args.includes("--fix") || args.includes("-f");

let version = coreMetadata.version;
let mismatched = 0;
for (const member of workspaceMembers) {
  const root = dirname(import.meta.dirname!);
  for await (const entry of glob(member, { cwd: root, withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const memberPath = join(entry.parentPath, entry.name);

    // deno.json
    const denoJsonPath = join(memberPath, "deno.json");
    let denoJson: string;
    try {
      denoJson = await readFile(denoJsonPath, "utf8");
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    const deno = JSON.parse(denoJson);
    if (deno.version) {
      if (version == null) version = deno.version;
      else if (version !== deno.version) {
        mismatched++;
        console.error(
          "Version mismatch in %o: expected %o, found %o",
          denoJsonPath,
          version,
          deno.version,
        );
        if (fix) {
          deno.version = version;
          await writeFile(
            denoJsonPath,
            JSON.stringify(deno, null, 2) + "\n",
          );
          console.error("Fixed version in %o", denoJsonPath);
        }
      }
    }

    // package.json
    const pkgJsonPath = join(memberPath, "package.json");
    let pkgJson: string;
    try {
      pkgJson = await readFile(pkgJsonPath, "utf8");
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    const pkg = JSON.parse(pkgJson);
    if (pkg.version) {
      if (version == null) version = pkg.version;
      else if (version !== pkg.version) {
        mismatched++;
        console.error(
          "Version mismatch in %o: expected %o, found %o",
          pkgJsonPath,
          version,
          pkg.version,
        );
        if (fix) {
          pkg.version = version;
          await writeFile(
            pkgJsonPath,
            JSON.stringify(pkg, null, 2) + "\n",
          );
          console.error("Fixed version in %o", pkgJsonPath);
        }
      }
    }
  }
}

if (mismatched > 0 && !fix) process.exit(1);
else if (mismatched > 0 && fix) {
  if (mismatched === 1) {
    console.error(
      "Fixed %d version mismatch. Please commit the changes.",
      mismatched,
    );
  } else {
    console.error(
      "Fixed %d version mismatches. Please commit the changes.",
      mismatched,
    );
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
