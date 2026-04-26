/**
 * Minimal Vitest config for a freshly scaffolded Alepha project.
 *
 * Defines `test.root` explicitly so Vitest doesn't walk up the directory
 * tree and inherit a parent monorepo config (which can pull in unrelated
 * setup files, database connections, etc.).
 */
export const vitestConfigTs = () =>
  `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: ".",
    globals: true,
  },
});
`;
