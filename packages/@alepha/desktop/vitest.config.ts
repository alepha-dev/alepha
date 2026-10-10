import { defineConfig } from "vitest/config";

import { workspaceProjects } from "../../../scripts/vitest.projects.ts";

/**
 * This workspace's Vitest projects.
 *
 * `projects` is spread by the repo-root `vitest.config.ts`; the default export
 * is what a standalone `vitest run` in this directory loads. Both read the
 * same array, so `yarn test` and `yarn w @alepha/desktop test` collect the
 * same files. The real Bun Worker specs are `*.bun.spec.ts`, run by
 * `yarn test:bun`.
 */
export const projects = workspaceProjects(import.meta.url, {
  name: "@alepha/desktop",
});

export default defineConfig({ test: { projects } });
