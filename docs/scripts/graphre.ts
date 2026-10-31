import { createRequire } from "node:module";

/**
 * `graphre` as ES named exports, for `mermaid.tsx` loaded through Vite.
 *
 * The package is a UMD bundle: Node's CommonJS lexer sees no named exports
 * in it, so `import { layout } from "graphre"` fails at link time. `require`
 * returns the populated object. `gen-tree.ts` aliases `graphre` to this file.
 */
const graphre = createRequire(import.meta.url)("graphre");

export const graphlib = graphre.graphlib;
export const layout = graphre.layout;
