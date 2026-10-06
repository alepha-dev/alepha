/**
 * Work's spec helpers (#E75, #Q2613): `WorkTestEntities` and the quest and
 * epic fixtures. Nothing at runtime imports `./testing`.
 *
 * @module
 */
export {
  createTestEpic,
  createTestQuest,
  WorkTestEntities,
} from "./entities.ts";

// Core's helpers, for a Work spec that needs a project or a member.
export {
  createTestMember,
  createTestMemberByProjectId,
  createTestProject,
} from "@lore/core/testing";

// Pages a route loads lazily, for the specs that render them: re-exported
// from `./web` as values they would fold into the static graph (#E75).
export { default as ProjectSettingsAreasPage } from "../web/app/components/project/settings/ProjectSettingsAreasPage.tsx";
export { default as ProjectSettingsBoardPage } from "../web/app/components/project/settings/ProjectSettingsBoardPage.tsx";
