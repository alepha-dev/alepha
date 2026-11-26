import { defineConfig } from "vitest/config";

import { workspaceProjects } from "../../../scripts/vitest.projects.ts";

/**
 * This workspace's Vitest projects.
 *
 * `projects` is spread by the repo-root `vitest.config.ts`; the default export
 * is what a standalone `vitest run` in this directory loads.
 */
export const projects = workspaceProjects(import.meta.url, {
  name: "mcp-example",
});

export default defineConfig({ test: { projects } });
