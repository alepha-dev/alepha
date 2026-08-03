/**
 * `vite.config.ts` — one config for the build and for the tests.
 *
 * There used to be a `vitest.config.ts` beside it. Vitest reads `vite.config.ts`
 * when no dedicated file exists, and `defineConfig` imported from
 * `vitest/config` types both halves, so the second file bought nothing except a
 * second place for plugins and aliases to drift apart — which is the failure
 * that actually hurts: tests resolving imports differently from the build.
 *
 * `test.root` is the one setting worth spelling out. Without it Vitest walks up
 * the directory tree looking for a config and can inherit a parent monorepo's,
 * pulling in setup files, database connections and projects that have nothing
 * to do with this app.
 */
export const viteConfigTs = () => {
  return `import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tailwindcss()],
  test: {
    root: ".",
    globals: true,
  },
});
`;
};
