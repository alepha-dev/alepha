/**
 * Build's spec helpers. Nothing at runtime imports `./testing`.
 *
 * @module
 */
export { BuildTestEntities } from "./entities.ts";

// Core's helpers, for a Build spec that needs a project or a member.
export {
  createTestMemberByProjectId,
  createTestProject,
} from "@lore/core/testing";
