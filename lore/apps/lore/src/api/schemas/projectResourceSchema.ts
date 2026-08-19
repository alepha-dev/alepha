import { type Infer, z } from "alepha";
import { projects } from "../entities/projects.ts";

/**
 * A project as the API hands it out.
 *
 * Identical to the entity except **`slug` is required**. The physical column
 * is nullable and must stay that way — SQLite refuses `ADD COLUMN … NOT NULL`
 * on a populated table, and a column DEFAULT on `projects` triggers the D1
 * rebuild that cascade-wipes members/quests/milestones/folios/feedback.
 *
 * Every readable row nonetheless has one: the migration backfilled them,
 * `createProject` always sets one (falling back to `project-<id>`), and
 * `ProjectDeletionService` only clears it on the way out — at which point the
 * row stops being readable at all, since reads filter soft-deleted rows.
 *
 * Declaring it required *here* is what lets the entire web app build URLs from
 * `project.slug` without a fallback at every call site. A row that somehow
 * lacks one fails response validation loudly, instead of silently rendering
 * every project link as `/`.
 */
export const projectResourceSchema = projects.schema.extend({
  slug: z.string(),
});

/**
 * A project as the UI sees it. Prefer this over the entity's `Project` for
 * anything that builds a URL — it is the type that guarantees `slug`.
 */
export type ProjectResource = Infer<typeof projectResourceSchema>;

/**
 * `projectResourceSchema` plus an area count sourced from the `areas`
 * table (`AreaService.countByProjectIds`). Scoped to `getHomeOverview` —
 * the endpoint that fills `userProjectsAtom` for the Home page's project
 * cards — rather than folded into `projectResourceSchema` itself, since
 * every other action returning a project (create/update/get) would then
 * need to compute a count nothing there reads.
 */
export const projectOverviewResourceSchema = projectResourceSchema.extend({
  areaCount: z.integer(),
});

export type ProjectOverviewResource = Infer<
  typeof projectOverviewResourceSchema
>;
