import type { DashboardMetricRequirement } from "./DashboardMetricCatalog.ts";
import type { DashboardPresetKey } from "./dashboardPresetKeySchema.ts";

/**
 * One card of a preset: a metric and its place. The scope is always the
 * project's own, and the filters the metric's defaults, as on the computed
 * board.
 */
export interface DashboardPresetCard {
  metric: string;
  size?: number;
  height?: number;
}

export interface DashboardPreset {
  key: DashboardPresetKey;
  labelKey: string;
  descriptionKey: string;
  /**
   * What the project must have on for the preset to be offered. A preset
   * whose need is unmet is shown disabled, saying which.
   */
  needs: DashboardMetricRequirement;
  /**
   * What the menu says when `needs` is unmet: what to turn on.
   */
  needsKey: string;
  cards: DashboardPresetCard[];
}

/**
 * The ready-made layouts the dashboard's edit menu offers (#Q3831).
 * Applying one replaces the dashboard's cards, after a confirmation, as
 * Reset to default does; a new dashboard can also start from one.
 *
 * A card whose own metric the project does not answer (Ship's `uptime`
 * option off, say) is left out when the preset is applied, so a preset
 * never stores a card that could only say "unavailable". A metric that
 * needs a subject picked (one epic's or one release's progress) is never
 * listed: a preset picks nothing.
 *
 * Imports nothing at runtime, so the edit menu reads it in the browser.
 */
export class DashboardPresetCatalog {
  public static readonly PRESETS: DashboardPreset[] = [
    {
      // Traffic, health, errors and uptime of the project's apps. There is
      // no web-vitals card yet: the vitals live on an app's own Vitals tab.
      key: "appVitals",
      labelKey: "dashboard.preset.appVitals",
      descriptionKey: "dashboard.preset.appVitals.description",
      needsKey: "dashboard.preset.needs.ship",
      needs: { capability: "ship" },
      cards: [
        { metric: "appHealth", size: 2 },
        { metric: "uniqueVisitors" },
        { metric: "openErrors" },
        { metric: "errorTrend", size: 2 },
        { metric: "uptime", size: 2 },
      ],
    },
    {
      // Coverage and tests, Reports' Quality since Build went (#Q4217): the
      // trend left the apps preset with it (#E162).
      key: "codeQuality",
      labelKey: "dashboard.preset.codeQuality",
      descriptionKey: "dashboard.preset.codeQuality.description",
      needsKey: "dashboard.preset.needs.quality",
      needs: { capability: "reports", option: "quality" },
      cards: [
        { metric: "qualityTrend", size: 2 },
        { metric: "quality.coverage.lines" },
        { metric: "quality.tests.failed" },
      ],
    },
    {
      key: "requirements",
      labelKey: "dashboard.preset.requirements",
      descriptionKey: "dashboard.preset.requirements.description",
      needsKey: "dashboard.preset.needs.plan.requirements",
      needs: { capability: "plan", option: "requirements" },
      cards: [
        { metric: "requirementCoverage", size: 2 },
        { metric: "useCaseHealth" },
        { metric: "personaHealth" },
        { metric: "requirementsToCover", size: 2 },
        { metric: "requirementCoverageTrend", size: 2 },
      ],
    },
    {
      // Proposed with the quest: what is waiting on somebody, for a
      // morning pass over the project.
      key: "triage",
      labelKey: "dashboard.preset.triage",
      descriptionKey: "dashboard.preset.triage.description",
      needsKey: "dashboard.preset.needs.plan",
      needs: { capability: "plan" },
      cards: [
        { metric: "needsYou", size: 2, height: 2 },
        { metric: "untriagedFeedback" },
        { metric: "openErrors" },
        { metric: "heldQuests" },
        { metric: "activeQuests" },
        { metric: "activityFeed", size: 2, height: 2 },
      ],
    },
    {
      // Proposed with the quest: where the next releases stand.
      key: "delivery",
      labelKey: "dashboard.preset.delivery",
      descriptionKey: "dashboard.preset.delivery.description",
      needsKey: "dashboard.preset.needs.plan.releases",
      needs: { capability: "plan", option: "releases" },
      cards: [
        { metric: "releaseOutlook", size: 2 },
        { metric: "releasesToPublish", size: 2 },
        { metric: "epicsInFlight", size: 2 },
        { metric: "activeQuests" },
        { metric: "heldQuests" },
      ],
    },
  ];

  public static find(key: string): DashboardPreset | undefined {
    return DashboardPresetCatalog.PRESETS.find((it) => it.key === key);
  }
}
