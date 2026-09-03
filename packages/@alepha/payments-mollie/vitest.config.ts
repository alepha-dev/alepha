import { defineConfig } from "vitest/config";

import { workspaceProjects } from "../../../vitest.projects.ts";

/**
 * This workspace's Vitest projects.
 *
 * `projects` is spread by the repo-root `vitest.config.ts`; the default export
 * is what a standalone `vitest run` in this directory loads. Both read the
 * same array, so `yarn test` and `yarn w @alepha/payments-mollie test` collect the same files.
 */
export const projects = workspaceProjects(import.meta.url, {
  name: "@alepha/payments-mollie",
});

export default defineConfig({ test: { projects } });
