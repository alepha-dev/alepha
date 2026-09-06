import type { CapabilityKey } from "@/api/schemas/capabilityKeySchema.ts";
import type { ProjectResource } from "@/api/schemas/projectResourceSchema.ts";
import { hasCapability } from "@/web/app/services/projectCapabilities.ts";

export type ReportsRouteName =
  | "reportsOverview"
  | "reportsQuests"
  | "reportsMembers"
  | "reportsQuality";

export type ReportsNavLabelKey =
  | "project.reports.nav.overview"
  | "project.reports.nav.quests"
  | "project.reports.nav.members"
  | "project.reports.nav.quality";

export interface ReportsTab {
  route: ReportsRouteName;
  labelKey: ReportsNavLabelKey;
  /**
   * The capability this tab's data source belongs to.
   *
   * ⚠️ Reports itself is CORE and its entry is unconditional, which is the
   * whole reason each tab declares its own: Quality is Apps baseline and
   * Members is derived from a core table, so an Apps-only project would lose
   * its Quality tab along with the Reports entry if the section belonged to
   * Work.
   */
  needs?: CapabilityKey;
  /**
   * Additionally requires a run to exist. Only Quality has one.
   */
  needsQualityRun?: boolean;
}

const TABS: ReportsTab[] = [
  {
    route: "reportsOverview",
    labelKey: "project.reports.nav.overview",
    needs: "work",
  },
  {
    route: "reportsQuests",
    labelKey: "project.reports.nav.quests",
    needs: "work",
  },
  // Members comes from a core table and needs nothing.
  { route: "reportsMembers", labelKey: "project.reports.nav.members" },
  {
    route: "reportsQuality",
    labelKey: "project.reports.nav.quality",
    needs: "apps",
    needsQualityRun: true,
  },
];

/**
 * Which Reports tabs this project has.
 *
 * Members is **derived** from rows Lore owns and exists for every project.
 * Overview and Quests are derived too, but from quests, so they belong to
 * Work. Quality is **ingested** from a foreign system, and most projects will
 * never push a run: a permanently empty fourth tab on everyone's Reports page
 * is worse than no tab at all.
 *
 * ⚠️ **Quality lost its switch and joined the Apps baseline.** It is pushed by
 * CI under a CI credential, it is about the software rather than about a
 * running copy, and it already shared the never-turn-someone's-build-red rule
 * with artifact push and sigil ingest - so there was never anything for a
 * switch to decide. What replaced the flag is `hasRun`, which is the honest
 * question: the tab exists once there is something in it. Blights self-hides
 * the same way.
 *
 * A function rather than a constant because the answer depends on the project,
 * and a separate file rather than a body inside `ReportsLayout` because a rule
 * about which tabs exist is worth asserting without rendering anything.
 */
export const reportsTabs = (
  project: Pick<ProjectResource, "capabilities"> | undefined,
  hasQualityRun = false,
): ReportsTab[] =>
  TABS.filter(
    (tab) =>
      (!tab.needs || hasCapability(project, tab.needs)) &&
      (!tab.needsQualityRun || hasQualityRun),
  );
