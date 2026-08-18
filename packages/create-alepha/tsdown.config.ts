import { join } from "node:path";

/**
 * `alepha` is bundled in, not required at install time.
 *
 * This package is a ~150-line shell over `ProjectScaffolder`, which lives in
 * `alepha/cli` so that `npm create alepha` and `alepha init` scaffold the same
 * project from one source. Depending on `alepha` to reach it, though, made
 * `npm create alepha` download the whole framework toolchain — biome,
 * drizzle-kit, vite, vitest, tsx, postgres, redis — into the npx cache just to
 * write text files, and the scaffolded project then installed all of it again
 * in its own `node_modules`. Inlining it costs ~900 kB of dist and leaves the
 * package with no runtime dependencies at all.
 *
 * Three things survive the inlining, and they are what make it safe:
 *
 * - The version written into new projects comes from
 *   `import pkg from "alepha/package.json"`, which rolldown resolves at build
 *   time. It is frozen into the bundle, which is the same guarantee the
 *   exact-pinned dependency used to give.
 * - Shelled commands (`alepha db migrations create`, `<pm> run lint`) resolve
 *   through `NodeShellProvider.localBinPath()`, which prepends the *new
 *   project's* `node_modules/.bin`. They never wanted this package's own.
 * - `AlephaCliUtils.resolveBin`, the one thing that resolves from this
 *   package's location, is not on the init path.
 *
 * `alepha` stays in devDependencies — typecheck, tests and the workspace
 * source entry (`main: ./src/index.ts`) all still import it, and
 * `yarn workspaces foreach --all version` keeps that pin in lockstep on
 * release exactly as it does for the other packages.
 */
export default {
  entry: join(import.meta.dirname, "src/index.ts"),
  format: ["esm"],
  platform: "node",
  sourcemap: true,
  fixedExtension: false,
  deps: {
    alwaysBundle: [/^alepha(\/|$)/],
  },
  outDir: join(import.meta.dirname, "dist"),
  dts: true,
};
