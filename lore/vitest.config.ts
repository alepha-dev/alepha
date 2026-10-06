import { defineConfig } from "vitest/config";

import { projects as lore } from "./apps/lore/vitest.config.ts";
import { projects as loreSdk } from "./packages/@alepha/lore/vitest.config.ts";
import { projects as loreCore } from "./packages/@lore/core/vitest.config.ts";
import { projects as loreDeploy } from "./packages/@lore/deploy/vitest.config.ts";
import { projects as loreKnowledge } from "./packages/@lore/knowledge/vitest.config.ts";
import { projects as loreWork } from "./packages/@lore/work/vitest.config.ts";
import { workspaceProjects } from "./scripts/vitest.projects.ts";

/**
 * The suite, as one project per workspace. Each workspace owns a
 * `vitest.config.ts` naming itself through `workspaceProjects`; this file is
 * the import list that makes a root `yarn test` the union of them.
 *
 * `apps/e2e` is out of it on purpose: it drives built artefacts and a Go
 * toolchain, and runs through `yarn e2e` and `yarn e2e-cli`. The vendored framework is out of
 * it too: its suite runs where it is developed, in `alepha-dev/alepha`.
 */
export default defineConfig({
  test: {
    projects: [
      ...workspaceProjects(import.meta.url, {
        name: "lore-monorepo",
        include: ["*.spec.ts", "scripts/**/*.spec.ts"],
      }),
      ...lore,
      ...loreSdk,
      ...loreCore,
      ...loreWork,
      ...loreKnowledge,
      ...loreDeploy,
    ],
  },
});
