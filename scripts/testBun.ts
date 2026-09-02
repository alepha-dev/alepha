import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";

import { testServiceEnv } from "../test.slot.ts";

/**
 * `yarn test:bun`, with this checkout's slice of the shared test services.
 *
 * A wrapper rather than a plain `bun test ...` in `package.json`, because the
 * bun specs need the same partition the vitest ones get from
 * `vitest.config.ts` and there is nowhere else to put it: `bun test` reads no
 * config of ours, and `RunOptions` has no `env`.
 *
 * ⚠️ **The alternative that does not work**: importing `test.slot.ts` from the
 * spec itself. `packages/alepha`'s declaration build runs with
 * `rootDir: src`, so a spec reaching outside that tree fails the build with
 * TS6059 - and `yarn v --fast` skips `build`, so it fails only in the full
 * lane and only after everything else has passed.
 *
 * Run by bun rather than node, so the TypeScript import needs no loader.
 */
// Expanded here rather than passed through. `bun test` treats its arguments
// as FILTERS, not globs, so a literal `./packages/**/*.bun.spec.ts` matches
// nothing and exits 1 - which is what the old `package.json` line relied on
// the shell to prevent.
const specs = globSync("packages/**/*.bun.spec.ts");
if (specs.length === 0) {
  console.error("No .bun.spec.ts files found.");
  process.exit(1);
}

const { status } = spawnSync(
  "bun",
  ["test", ...specs, ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: { ...process.env, ...testServiceEnv() },
  },
);

process.exit(status ?? 1);
