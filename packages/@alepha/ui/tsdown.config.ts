import { defineConfig } from "tsdown";

/**
 * `@alepha/ui` builds to `dist/` instead of publishing raw `.tsx`.
 *
 * Shipping source made every consumer's bundler treat the package as project
 * code. Vite in particular transforms it in place but never descends into it
 * when scanning for dependencies to pre-bundle, so every bare import made
 * *inside* a component escaped optimization. Any CommonJS-only package among
 * them was then handed to the browser raw — `does not provide an export named
 * 'default'` — which broke the module graph, stopped hydration, and turned the
 * login form into a native GET with the password in the query string. The same
 * split gave `alepha` two module instances and two `AlephaContext` objects,
 * so `useAlepha()` threw inside the provider that rendered it.
 *
 * As an ordinary built dependency none of that arises: Vite pre-bundles the
 * package whole, once, and its imports resolve in the same graph as the app's.
 *
 * ## Why `unbundle`
 *
 * The public API is one subpath per module: `@alepha/ui/form` is
 * `src/form/index.ts`, a barrel of explicit re-exports. Inside the package
 * every import is relative and names a concrete file, and `unbundle` emits one
 * output file per source file with those imports kept as they are. So the
 * barrel stays a list of re-exports a consumer's bundler can tree-shake (an
 * app importing `Button` from `@alepha/ui` does not pull the other
 * primitives), and a relative import never inlines a sibling module into
 * another, which would give that sibling two copies of its state.
 */
export default defineConfig({
  entry: ["src/**/*.{ts,tsx}", "!src/**/__tests__/**", "!src/**/*.spec.*"],
  outDir: "dist",
  format: ["esm"],
  platform: "browser",
  // Mirrors `src/` into `dist/`, so `dist/<module>/index.js` is where the
  // publish map says it is.
  unbundle: true,
  // `.js`, not `.mjs`: the publish map names `dist/<module>/index.js`.
  fixedExtension: false,
  sourcemap: true,
  // Declarations come from `tsc --emitDeclarationOnly` in the build script.
  // rolldown-plugin-dts re-resolves the shared React + alepha type graph once
  // per entry, and there are over two hundred of them; one `tsc` program sees
  // it once.
  dts: false,
  // Everything in `dependencies` and `peerDependencies` stays external, which
  // is the default. React and `alepha` especially: bundling either would
  // reintroduce the duplicate-instance problem this change exists to remove.
  deps: {
    // Stylesheets stay stylesheets. Inlining `MarkdownView.css` into the JS
    // would hand consumers a component that injects styles at import time and
    // bypasses their Tailwind/PostCSS pipeline entirely; leaving the import
    // relative lets their bundler process it as it does their own CSS. The
    // build script copies the file into `dist/` beside its module.
    neverBundle: [/\.css$/],
  },
});
