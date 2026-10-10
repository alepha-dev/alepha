import { defineConfig } from "tsdown";

/**
 * One entry per audience, all ESM for Bun.
 *
 * `core` is the protocol both sides of the Worker boundary agree on. `worker`
 * runs inside the compiled app's server Worker and must never reach native
 * code: it drives the app's own Alepha instance through its public methods.
 *
 * zod stays external for both the JS and the declarations, as in the root
 * config: its `v4/locales/*.d.cts` files cannot be bundled into a `.d.ts`.
 */
export default defineConfig({
  entry: {
    "core/index": "src/core/index.ts",
    "worker/index": "src/worker/index.ts",
  },
  outDir: "dist",
  format: ["esm"],
  platform: "node",
  fixedExtension: false,
  sourcemap: true,
  dts: true,
  deps: { neverBundle: [/^zod(\/|$)/], dts: { neverBundle: [/^zod(\/|$)/] } },
});
