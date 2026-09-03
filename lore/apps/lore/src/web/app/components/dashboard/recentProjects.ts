import type { ProjectOverviewResource } from "@/api/schemas/projectResourceSchema.ts";

import { RECENT_PROJECTS_CAP } from "../project/recentProjectsCap.ts";

/**
 * The dashboard's "your recent projects" view of the membership list: most
 * recently updated first, capped for display.
 *
 * Extracted when the landing page grew a second surface for the same list
 * (#1754): the rail at `lg` and up, and an inline section below it. The two
 * are the same idea at two widths, so a reader who counts five in one and six
 * in the other - or sees a different order after a resize - learns that one of
 * them is lying about what "recent" means. `RECENT_PROJECTS_CAP` already
 * carries that argument for the rail and `ProjectSwitcher`; this is the sort
 * beside it.
 *
 * ⚠️ Display only. `userProjectsAtom` stays the COMPLETE list, because
 * Spotlight filters that array client-side - see the cap's own warning.
 */
export const recentProjects = (
  projects: ProjectOverviewResource[] | undefined,
): { shown: ProjectOverviewResource[]; total: number; hasMore: boolean } => {
  const sorted = [...(projects ?? [])].sort((a, b) =>
    a.updatedAt > b.updatedAt ? -1 : 1,
  );
  return {
    shown: sorted.slice(0, RECENT_PROJECTS_CAP),
    total: sorted.length,
    hasMore: sorted.length > RECENT_PROJECTS_CAP,
  };
};
