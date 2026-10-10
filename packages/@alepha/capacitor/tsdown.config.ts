import { defineConfig } from "tsdown";

/**
 * Three audiences, built apart.
 *
 * - The WebView: `core` and `ota` (the live updater's device client and its
 *   wire schemas), browser platform, `@capacitor/*`, `@capgo/*` and `alepha`
 *   external.
 * - The host app's server and its admin: `ota-api` and `ota-admin`, neutral
 *   platform, since a server runs on Node, Bun or workerd and an admin page
 *   renders on both sides.
 * - The `alepha` command's Node process: `cli`, the only place allowed to
 *   reach Node built-ins, the native project files, the build pipeline and
 *   the publisher's signing key.
 *
 * `packaging.spec.ts` checks the graphs: `core` reaches no `ota*` and no
 * `cli`, `ota` no server or admin code, `ota-api` nothing of `ota` beyond
 * `ota/protocol` and nothing of `ota-admin`.
 *
 * `.` is `core` under another name, so it is not an entry of its own.
 *
 * zod stays external for both the JS and the declarations, as in the root
 * config: its `v4/locales/*.d.cts` files cannot be bundled into a `.d.ts`.
 */
export default defineConfig([
  {
    entry: {
      "core/index": "src/core/index.ts",
      "ota/index": "src/ota/index.ts",
    },
    outDir: "dist",
    format: ["esm"],
    platform: "browser",
    fixedExtension: false,
    sourcemap: true,
    dts: true,
    deps: { neverBundle: [/^zod(\/|$)/], dts: { neverBundle: [/^zod(\/|$)/] } },
  },
  {
    entry: {
      "ota-api/index": "src/ota-api/index.ts",
      "ota-admin/index": "src/ota-admin/index.ts",
    },
    outDir: "dist",
    // The first config already cleaned `dist/`.
    clean: false,
    format: ["esm"],
    platform: "neutral",
    fixedExtension: false,
    sourcemap: true,
    dts: true,
    deps: { neverBundle: [/^zod(\/|$)/], dts: { neverBundle: [/^zod(\/|$)/] } },
  },
  {
    entry: { "cli/index": "src/cli/index.ts" },
    outDir: "dist",
    clean: false,
    format: ["esm"],
    platform: "node",
    fixedExtension: false,
    sourcemap: true,
    dts: true,
    deps: { neverBundle: [/^zod(\/|$)/], dts: { neverBundle: [/^zod(\/|$)/] } },
  },
]);
