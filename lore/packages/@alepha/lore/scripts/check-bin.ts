import { readdirSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseAst } from "rolldown/parseAst";

/**
 * The published `lore` binary must import nothing but builtins.
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
 *
 * A builtin counts whatever its spelling: postgres.js, which the ORM loads on
 * connect since every app carries Postgres (#E142), imports `net` and `tls`
 * without the `node:` prefix, and a global install has them all the same. So
 * does a `bun:` module, imported only by the Bun driver's own chunk, which
 * nothing loads outside Bun.
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
      !isBuiltin(source) &&
      !source.startsWith("bun:") &&
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
