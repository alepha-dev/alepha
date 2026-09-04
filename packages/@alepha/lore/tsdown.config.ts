import { defineConfig } from "tsdown";

/**
 * `@alepha/lore` is the one package with two independent halves, so it builds
 * from its own config instead of the shared root one.
 *
 * The root config knows a single shape: `src/index.ts`, plus `src/index.browser.ts`
 * when it exists. This package publishes `./sigil` and `./cli`, which no host
 * ever installs for the same reason: a browser app pulls the reporter, a CI
 * runner pulls the command. Each subpath therefore gets its own build, and the
 * output mirrors `src/` so `dist/sigil/index.js` and `dist/cli/index.js` line
 * up with what `publishConfig.exports` promises.
 *
 * `fixedExtension: false` on every entry: the exports map names `.js`, and a
 * `.mjs` output resolves to nothing.
 */

// zod is a runtime dependency, never bundled. Its `v4/locales/*.d.cts` type
// files use CommonJS dts syntax that rolldown-plugin-dts cannot bundle, so it
// must be external for both the JS bundle (`neverBundle`) and the .d.ts bundle
// (`dts.neverBundle`, which tsdown externalizes separately).
const zod = /^zod(\/|$)/;
const deps = { neverBundle: [zod], dts: { neverBundle: [zod] } };

export default defineConfig([
  {
    entry: "src/sigil/index.ts",
    format: ["esm"],
    sourcemap: true,
    fixedExtension: false,
    outDir: "dist/sigil",
    dts: true,
    deps,
  },
  {
    entry: "src/sigil/index.browser.ts",
    platform: "browser",
    sourcemap: true,
    fixedExtension: false,
    dts: false,
    outDir: "dist/sigil",
  },
  {
    entry: "src/cli/index.ts",
    format: ["esm"],
    platform: "node",
    sourcemap: true,
    fixedExtension: false,
    outDir: "dist/cli",
    dts: true,
    deps,
  },
  // The `lore` binary. `dts: false` is load-bearing rather than an
  // optimisation: a bin has no consumers, so its types are dead weight, and
  // emitting them hands `scripts/check-dts.ts` a new `.d.ts` to walk for the
  // private `lore` workspace it exists to keep out of `dist`.
  {
    entry: "src/bin/index.ts",
    format: ["esm"],
    platform: "node",
    sourcemap: true,
    fixedExtension: false,
    outDir: "dist/bin",
    dts: false,
    deps,
  },
]);
