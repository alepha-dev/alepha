import { defineConfig } from "vite";

export default defineConfig({
  ssr: {
    // `@alepha/lore` comes from npm, but `alepha` in this repository is the
    // workspace, whose exports point at `.ts`/`.tsx` source. Externalized, the
    // sigil would be loaded by Node itself, its `import "alepha/..."` would hit
    // that source untransformed (`Unknown file extension ".tsx"`), and even
    // once past that it would bind to a second `alepha` instance from the one
    // the app runs on. Inlined, Vite resolves it against the same workspace
    // `alepha` as the app (#Q2688). An app outside this repository resolves
    // `alepha` to its built `dist` and needs none of this.
    // The pinned Yarn patch migrates the published 0.32.0 sigil hooks to the
    // V1 names used by this workspace. Remove it when a compatible Lore
    // package is released; the framework must keep rejecting retired hooks.
    noExternal: ["@alepha/lore"],
  },
});
