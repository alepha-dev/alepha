/**
 * Knowledge's spec helpers (#E75, #Q2612): `KnowledgeTestEntities` and the
 * folio fixtures. Nothing at runtime imports `./testing`.
 *
 * @module
 */
export {
  createTestFolio,
  filedEpicOf,
  KnowledgeTestEntities,
} from "./entities.ts";

// Core's helpers, for a Knowledge spec that needs a project or a member.
export {
  createTestMember,
  createTestMemberByProjectId,
  createTestProject,
} from "@lore/core/testing";
