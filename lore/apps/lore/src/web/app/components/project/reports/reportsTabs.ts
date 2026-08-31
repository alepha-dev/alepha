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
   * The project feature this tab's data source hangs off. Absent for the three
   * tabs derived from rows Lore already owns, which exist unconditionally.
   */
  needsFeature?: "quality";
}

const TABS: ReportsTab[] = [
  { route: "reportsOverview", labelKey: "project.reports.nav.overview" },
  { route: "reportsQuests", labelKey: "project.reports.nav.quests" },
  { route: "reportsMembers", labelKey: "project.reports.nav.members" },
  {
    route: "reportsQuality",
    labelKey: "project.reports.nav.quality",
    needsFeature: "quality",
  },
];

/**
 * Which Reports tabs this project has.
 *
 * Overview, Quests and Members are **derived** from rows Lore owns, so they
 * exist for every project and always have something to render. Quality is
 * **ingested** from a foreign system, and most projects will never push a run:
 * a permanently empty fourth tab on everyone's Reports page is worse than no
 * tab at all.
 *
 * The gate is `AppLayout`'s `needsBeacon` applied to a project feature rather
 * than to an app's capability. ⚠️ An ABSENT flag reads as off, which is the
 * common case rather than the edge one: `features.quality` is `.optional()` and
 * deliberately outside `defaultProjectFeatures`, so every project that predates
 * this module carries no key at all.
 *
 * A function rather than a constant because the answer depends on the project,
 * and a separate file rather than a body inside `ReportsLayout` because a rule
 * about which tabs exist is worth asserting without rendering anything.
 */
export const reportsTabs = (
  features: Record<string, boolean | undefined> | undefined,
): ReportsTab[] =>
  TABS.filter((tab) => !tab.needsFeature || features?.[tab.needsFeature]);
