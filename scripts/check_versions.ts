import { expandGlob } from "@std/fs";
import { dirname, join } from "@std/path";
import workspaceMetadata from "../deno.json" with { type: "json" };
import coreMetadata from "../packages/core/deno.json" with { type: "json" };

if (Deno.args.includes("--help") || Deno.args.includes("-h")) {
  console.log("Usage: deno task check-versions [--help|-h] [--fix|-f]");
  console.log("Checks that all workspace members have the same version.");
  console.log(
    "If --fix or -f is provided, it will attempt to fix version mismatches.",
  );
  Deno.exit(0);
}

const workspaceMembers = workspaceMetadata.workspace;
const fix = Deno.args.includes("--fix") || Deno.args.includes("-f");

let version = coreMetadata.version;
let mismatched = 0;
for (const member of workspaceMembers) {
  const globPath = join(dirname(import.meta.dirname!), member);
  for await (const entry of expandGlob(globPath)) {
    if (!entry.isDirectory) continue;
    const memberPath = entry.path;

    // deno.json
    const denoJsonPath = join(memberPath, "deno.json");
    let denoJson: string;
    try {
      denoJson = await Deno.readTextFile(denoJsonPath);
    } catch {
      continue;
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
          await Deno.writeTextFile(
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
      pkgJson = await Deno.readTextFile(pkgJsonPath);
    } catch {
      continue;
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
          await Deno.writeTextFile(
            pkgJsonPath,
            JSON.stringify(pkg, null, 2) + "\n",
          );
          console.error("Fixed version in %o", pkgJsonPath);
        }
      }
    }
  }
}

if (mismatched > 0 && !fix) Deno.exit(1);
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
