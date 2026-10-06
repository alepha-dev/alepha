import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The published types must never name a private `@lore/*` package.
 *
 * `@alepha/lore/cli` reaches Lore's controllers through `import type` of the
 * `@lore/*` packages, which are `private` and never go to the registry.
 * `import type` is erased, so as long as those types stay internal
 * the emitted `.d.ts` says nothing about them. Leak one into an exported
 * signature and the published package declares a dependency on a workspace
 * nobody outside this repo can resolve, and the failure lands on whoever
 * installs the tarball rather than on us.
 *
 * Cheap to check and impossible to notice by eye, so it runs on every build.
 */
const dist = fileURLToPath(new URL("../dist", import.meta.url));

const walk = (dir: string): string[] => {
  let files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      files = files.concat(walk(path));
    } else if (path.endsWith(".d.ts")) {
      files.push(path);
    }
  }
  return files;
};

let declarations: string[];
try {
  declarations = walk(dist);
} catch {
  console.error(`check-dts: no dist/ at ${dist}. Run the build first.`);
  process.exit(1);
}

// `from "lore"` and `from "lore/anything"`, in either quote style, and the
// `import("lore/...")` form tsc emits for an inlined type reference. The
// `@lore/*` packages are as private as the app they were split out of
// (#E75), so `@lore/core` and its siblings are refused the same way.
const leak =
  /(?:from\s*|import\s*\()\s*["'](?:@lore\/[^"'/]+|lore)(?:\/[^"']*)?["']/;

const offenders = declarations.filter((file) =>
  leak.test(readFileSync(file, "utf8")),
);

if (offenders.length > 0) {
  console.error(
    `\n${offenders.length} declaration file(s) reference the private \`lore\` workspace or an \`@lore/*\` package:\n\n` +
      `${offenders.map((file) => `  ${file}`).join("\n")}\n\n` +
      "A type from `apps/lore` reached an exported signature. Keep it internal:\n" +
      "type it at the call site instead of returning or accepting it.\n",
  );
  process.exit(1);
}
