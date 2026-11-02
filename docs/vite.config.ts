import { defineConfig } from "vite";

export default defineConfig({
  ssr: {
    // `@alepha/lore` and `alepha` are both workspaces here, whose exports
    // point at `.ts`/`.tsx` source. Externalized, the sigil would be loaded by
    // Node itself, its `import "alepha/..."` would hit that source
    // untransformed (`Unknown file extension ".tsx"`). Inlined, Vite
    // resolves it against the same workspace `alepha` as the app (#Q2688).
    // An app outside this repository resolves both to their built `dist` and
    // needs none of this.
    noExternal: ["@alepha/lore"],
  },
});
