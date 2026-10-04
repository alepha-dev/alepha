import { defineConfig } from "tsdown";

/**
 * Two entries with two audiences, built apart.
 *
 * `core` runs in a WebView: browser platform, `@capacitor/*` and `alepha`
 * external, nothing from `cli`. `cli` runs in the `alepha` command's Node
 * process and is the only place allowed to reach Node built-ins, the native
 * project files and the build pipeline. `packaging.spec.ts` checks that the
 * built `core` graph never reaches `cli`.
 *
 * `.` is `core` under another name, so it is not an entry of its own.
 *
 * zod stays external for both the JS and the declarations, as in the root
 * config: its `v4/locales/*.d.cts` files cannot be bundled into a `.d.ts`.
 */
export default defineConfig([
  {
    entry: { "core/index": "src/core/index.ts" },
    outDir: "dist",
    format: ["esm"],
    platform: "browser",
    fixedExtension: false,
    sourcemap: true,
    dts: true,
    deps: { neverBundle: [/^zod(\/|$)/], dts: { neverBundle: [/^zod(\/|$)/] } },
  },
  {
    entry: { "cli/index": "src/cli/index.ts" },
    outDir: "dist",
    // The first config already cleaned `dist/` and wrote `core` into it.
    clean: false,
    format: ["esm"],
    platform: "node",
    fixedExtension: false,
    sourcemap: true,
    dts: true,
    deps: { neverBundle: [/^zod(\/|$)/], dts: { neverBundle: [/^zod(\/|$)/] } },
  },
]);
