import { defineConfig } from "tsdown";

/**
 * One entry per audience, all ESM for Bun.
 *
 * `core` is the protocol both sides of the Worker boundary agree on. `worker`
 * runs inside the compiled app's server Worker and must never reach native
 * code: it drives the app's own Alepha instance through its public methods.
 * `shell` is the main thread; its native modules are lazy `import()`s, and
 * `webview-bun` (a dependency) stays external so its `libwebview.dylib` is
 * resolved from the app's own `node_modules` when the app is compiled.
 * `cli` is what `alepha compile --desktop` resolves and calls.
 *
 * zod stays external for both the JS and the declarations, as in the root
 * config: its `v4/locales/*.d.cts` files cannot be bundled into a `.d.ts`.
 */
export default defineConfig({
  entry: {
    "core/index": "src/core/index.ts",
    "worker/index": "src/worker/index.ts",
    "shell/index": "src/shell/index.ts",
    "cli/index": "src/cli/index.ts",
  },
  outDir: "dist",
  format: ["esm"],
  platform: "node",
  fixedExtension: false,
  sourcemap: true,
  dts: true,
  deps: {
    neverBundle: [/^zod(\/|$)/, /^bun:/],
    dts: { neverBundle: [/^zod(\/|$)/] },
  },
});
