import { LoreCoreApi } from "@lore/core/api";
import { $module } from "alepha";

/**
 * The server half of `@lore/build`, Lore's fourth pillar: the code a project
 * holds, its git repositories, and what measures that code.
 *
 * It depends on `@lore/core` only: a feature that spans two modules goes
 * through a core registry or a core link, never through an import of another
 * feature module (`check:conventions`).
 *
 * Registered by `apps/lore/src/main.server.ts`, after every entry-level
 * substitution, between Remember and Ship.
 *
 * @module
 */
export const LoreBuildApi = $module({
  name: "lore.build.api",
  // Core first: booting this module alone boots what it depends on.
  imports: [LoreCoreApi],
  services: [],
});
