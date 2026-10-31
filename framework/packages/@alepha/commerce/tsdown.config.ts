import { defineConfig } from "tsdown";

/**
 * `@alepha/commerce` builds to `dist/`, the way `@alepha/ui` does and for the
 * same reasons: see the note there.
 *
 * `unbundle` because the package is many subpaths, some of them server modules
 * and some React components. One output file per source file means a storefront
 * importing `@alepha/commerce/admin/components/admin-orders` pulls no server
 * code it does not import, and two subpaths sharing a service share one copy of
 * it. Bundling each entry would give every subpath its own `OrderService`, and
 * the container would see them as different services.
 */
export default defineConfig({
  entry: ["src/**/*.{ts,tsx}", "!src/**/__tests__/**", "!src/**/*.spec.*"],
  outDir: "dist",
  format: ["esm"],
  platform: "neutral",
  unbundle: true,
  // `.js`, not `.mjs`: the publish map names `dist/<module>/index.js`.
  fixedExtension: false,
  sourcemap: true,
  // Declarations come from `tsc --emitDeclarationOnly` in the build script,
  // for the reason `@alepha/ui` gives.
  dts: false,
});
