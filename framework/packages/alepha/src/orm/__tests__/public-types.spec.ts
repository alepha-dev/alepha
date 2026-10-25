import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * `alepha/orm` pins drizzle exactly and keeps it out of its own API: the one
 * drizzle name its declarations may carry is `SQL`, the type of the `sql` tag
 * it re-exports. Everything else from drizzle is `alepha/orm/drizzle`, outside
 * semver (#Q2656).
 *
 * This emits the declarations of `alepha/orm` and `alepha/orm/postgres` with
 * the real compiler, `stripInternal` on, and walks every `.d.ts` they reach
 * through relative imports. A member tagged `@internal` (driver plumbing such
 * as `DatabaseProvider.db`) is stripped first: it is not part of the frozen
 * surface. Declaration emit writes inferred types out, so a public member that
 * leaks a drizzle type without naming it is caught too.
 */
describe("alepha/orm public declarations", () => {
  const srcDir = fileURLToPath(new URL("../../", import.meta.url));
  const packageDir = join(srcDir, "..");
  const require = createRequire(import.meta.url);
  const tscBin = join(
    dirname(require.resolve("typescript/package.json")),
    "bin/tsc",
  );

  let outDir = "";
  let workDir = "";

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "alepha-orm-dts-"));
    outDir = join(workDir, "dts");
    const tsconfig = join(workDir, "tsconfig.json");
    writeFileSync(
      tsconfig,
      JSON.stringify({
        extends: join(packageDir, "tsconfig.base.json"),
        compilerOptions: {
          types: ["node", "bun"],
          // The config sits in a temp directory, out of reach of the usual
          // `node_modules/@types` walk.
          typeRoots: [
            dirname(dirname(require.resolve("@types/node/package.json"))),
          ],
          noEmit: false,
          declaration: true,
          emitDeclarationOnly: true,
          stripInternal: true,
          rootDir: srcDir,
          outDir,
        },
        files: [
          join(srcDir, "orm/core/index.ts"),
          join(srcDir, "orm/postgres/index.ts"),
        ],
      }),
    );
    execFileSync(process.execPath, [tscBin, "-p", tsconfig], {
      cwd: packageDir,
      stdio: "pipe",
    });
  }, 120_000);

  afterAll(() => {
    if (workDir) {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  /**
   * Every drizzle name the declarations reachable from the two entries import,
   * as `file: name <- module`.
   */
  const drizzleNames = (): string[] => {
    const ormDir = join(outDir, "orm");
    const queue = ["orm/core/index.d.ts", "orm/postgres/index.d.ts"].map(
      (entry) => join(outDir, entry),
    );
    const seen = new Set<string>();
    const found: string[] = [];

    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file) || !existsSync(file)) continue;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      const where = relative(outDir, file);

      for (const match of source.matchAll(
        /(?:from\s+|import\()\s*"([^"]+)"/g,
      )) {
        const specifier = match[1];
        if (!specifier.startsWith(".")) continue;
        const target = resolve(dirname(file), specifier);
        // Only inside `orm/`: another module is `alepha/<module>`, frozen on
        // its own terms.
        if (relative(ormDir, target).startsWith("..")) continue;
        queue.push(`${target.replace(/\.(ts|js)$/, "")}.d.ts`);
      }

      for (const match of source.matchAll(
        /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"(drizzle-[^"]+)"/g,
      )) {
        for (const raw of match[1].split(",")) {
          const name = raw.replace(/^\s*type\s+/, "").trim();
          if (name && !(name === "SQL" && match[2] === "drizzle-orm")) {
            found.push(`${where}: ${name} <- ${match[2]}`);
          }
        }
      }
      for (const match of source.matchAll(
        /import\s+(?:type\s+)?\*\s+as\s+(\w+)\s+from\s+"(drizzle-[^"]+)"/g,
      )) {
        found.push(`${where}: * as ${match[1]} <- ${match[2]}`);
      }
      for (const match of source.matchAll(
        /import\("(drizzle-[^"]+)"\)\.(\w+)/g,
      )) {
        found.push(`${where}: ${match[2]} <- ${match[1]}`);
      }
      for (const match of source.matchAll(
        /export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+"(drizzle-[^"]+)"/g,
      )) {
        if (!/^export\s+\{\s*(?:type\s+)?SQL,\s*sql\s*\}/.test(match[0])) {
          found.push(`${where}: ${match[0]}`);
        }
      }
    }

    return found;
  };

  it("names no drizzle type other than SQL", () => {
    expect(drizzleNames()).toEqual([]);
  });

  it("still re-exports the sql tag and its SQL type", () => {
    const shared = readFileSync(
      join(outDir, "orm/core/index.shared.d.ts"),
      "utf8",
    );
    expect(shared).toMatch(/export \{ type SQL, sql \} from "drizzle-orm"/);
  });
});
