import { type Infer, z } from "alepha";

/**
 * Who may read a project's roadmap.
 *
 * Three positions rather than a boolean, because the middle one is the point:
 * a project can hand a stakeholder a roadmap without publishing it to the
 * internet.
 *
 * - `off` refuses everyone, including members. The page 404s.
 * - `members` requires membership, the same rule every other project surface
 *   applies.
 * - `public` allows anonymous reads. This is the only anonymous read path in
 *   the application; see `RoadmapController`.
 *
 * `mode: "text"` so no `CHECK` constraint is generated and a fourth level
 * later is a code-only change with no migration. Same reasoning as
 * `epics.status` and `folioLinks.targetType`.
 *
 * ⚠️ Absent reads as `off`, and the fallback lives in
 * `ProjectSecurityService.roadmapVisibilityOf`, never in a column `DEFAULT`.
 * A column DEFAULT on `projects` triggers a table rebuild, and on D1
 * `DROP TABLE projects` cascade-wipes members, quests, releases, folios and
 * feedback - the 2026-05-13 incident. Precedents on this exact table:
 * `retentionDays`, `defaultSurface`, `tagColors`, `kanbanColumnConfig`.
 */
export const roadmapVisibilitySchema = z
  .enum(["off", "members", "public"])
  .meta({ mode: "text" });

export type RoadmapVisibility = Infer<typeof roadmapVisibilitySchema>;
