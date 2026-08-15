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
 * The public API is wildcard subpaths — `@alepha/ui/components/ui/button`
 * resolves through `"./components/*"`. Output has to mirror input one file at
 * a time for those to keep resolving, which is what `unbundle` does. It also
 * keeps the package tree-shakeable: an app importing one component does not
 * pull the other 162.
 */
export default defineConfig({
  entry: [
    "src/components/**/*.{ts,tsx}",
    "src/hooks/**/*.{ts,tsx}",
    "src/lib/**/*.{ts,tsx}",
    "!src/**/__tests__/**",
    "!src/**/*.spec.*",
  ],
  outDir: "dist",
  format: ["esm"],
  platform: "browser",
  // Mirrors `src/` into `dist/`, so `./components/*` keeps resolving.
  unbundle: true,
  // `./components/ui/button` must resolve to `button.js`, not `button.mjs`.
  fixedExtension: false,
  sourcemap: true,
  // Declarations come from `tsc --emitDeclarationOnly` in the build script.
  // rolldown-plugin-dts re-resolves the shared React + alepha type graph once
  // per entry, and there are 163 of them; one `tsc` program sees it once.
  dts: false,
  // Everything in `dependencies` and `peerDependencies` stays external, which
  // is the default. React and `alepha` especially: bundling either would
  // reintroduce the duplicate-instance problem this change exists to remove.
  deps: {
    // Stylesheets stay stylesheets. Inlining `markdown-view.css` into the JS
    // would hand consumers a component that injects styles at import time and
    // bypasses their Tailwind/PostCSS pipeline entirely; leaving the import
    // relative lets their bundler process it as it does their own CSS. The
    // build script copies the file into `dist/` beside its module.
    neverBundle: [/\.css$/],
  },
});
