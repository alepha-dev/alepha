import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseAst } from "rolldown/parseAst";

/**
 * The published `lore` binary must import nothing but `node:` builtins.
 *
 * `alepha` is an optional peer of this package, so a global install brings no
 * `alepha` at all, and the bin's build inlines it instead (`tsdown.config.ts`).
 * A bare import that slips past the inlining (a new dependency, an `alepha`
 * subpath the pattern no longer matches) still builds and still runs in this
 * monorepo, where every package resolves, and fails only on a stranger's
 * machine with `Cannot find package`. So it is refused here, on every build.
 *
 * Read from the parsed module, never with a regex over the text: the bundle
 * carries Alepha's project scaffolding, whose template strings are full of
 * lines that start with `import`.
 */
const bin = fileURLToPath(new URL("../dist/bin", import.meta.url));

let files: string[];
try {
  files = readdirSync(bin).filter((name) => name.endsWith(".js"));
} catch {
  console.error(`check-bin: no dist/bin at ${bin}. Run the build first.`);
  process.exit(1);
}

const offenders: string[] = [];
for (const name of files) {
  const program = parseAst(readFileSync(join(bin, name), "utf8"));
  for (const node of program.body) {
    const source =
      "source" in node && node.source && "value" in node.source
        ? node.source.value
        : undefined;
    if (
      typeof source === "string" &&
      !source.startsWith("node:") &&
      !source.startsWith(".")
    ) {
      offenders.push(`${name}: ${source}`);
    }
  }
}

if (offenders.length > 0) {
  console.error(
    `\nThe \`lore\` binary imports ${offenders.length} package(s) a global install will not have:\n\n` +
      `${offenders.map((line) => `  ${line}`).join("\n")}\n\n` +
      "Inline it in the bin entry of tsdown.config.ts (`deps.alwaysBundle`).\n",
  );
  process.exit(1);
}
