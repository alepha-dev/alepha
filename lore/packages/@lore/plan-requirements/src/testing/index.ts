/**
 * Requirements' spec helpers (#E153). Nothing at runtime imports
 * `./testing`.
 *
 * @module
 */

// Core's helpers, for a Requirements spec that needs a project or a member.
export {
  createTestMember,
  createTestMemberByProjectId,
  createTestProject,
} from "@lore/core/testing";
