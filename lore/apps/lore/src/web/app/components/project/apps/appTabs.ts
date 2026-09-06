import type { AppInstanceResource } from "@/api/schemas/appInstanceResourceSchema.ts";

export type AppTabRoute =
  | "app"
  | "appAnalytics"
  | "appVitals"
  | "appErrors"
  | "appExplore"
  | "appArtifacts"
  | "appSettings";

export type AppTabLabelKey =
  | "app.tab.dashboard"
  | "app.tab.analytics"
  | "app.tab.vitals"
  | "app.tab.errors"
  | "app.tab.explore"
  | "app.tab.artifacts"
  | "app.tab.settings";

export interface AppTab {
  route: AppTabRoute;
  labelKey: AppTabLabelKey;
  /**
   * What the instance must have unlocked for this tab to exist. Absent means
   * the tab is always there, which is true of exactly three: Overview,
   * Artifacts and Settings.
   *
   * A predicate rather than a set of booleans, because the two axes are not
   * the same question: `sigilId` is presence, and `kinds` is what that
   * credential is allowed to collect. `beacon` fills the view and vitals
   * datasets, `blights` fills the error groups, and an instance can carry
   * either without the other.
   */
  unlockedBy?: (instance: AppInstanceResource) => boolean;
}

/**
 * The tab set of an instance page, in the order it is drawn.
 *
 * ⚠️ **Data, not a hand-written sequence**, and that is the point of the file.
 * #1813 adds Environment and epic #1 adds Deploy, each with an `unlockedBy` of
 * its own; neither should have to rewrite the bar to arrive. **Ship the seam,
 * not the screen**: no placeholder tab renders for either, because Environment
 * is a security surface (encrypted at rest, values never returned) and a tab
 * standing there invites somebody to fill it in without the crypto.
 *
 * ⚠️ **Settings is always last**, in every combination, so tabs appear and
 * disappear BETWEEN Overview and Settings rather than at the edge of the bar.
 * That is what keeps the bar stable as an instance gains capabilities.
 *
 * ⚠️ No count badge on Errors, and no Changelog tab - the changelog and the
 * areas that feed it left epic #30 on 2026-09-05 (#1776, #1777, shelved). If
 * it returns, the likely home is inside the Artifacts tab, per tag, so no slot
 * is reserved here.
 */
export const APP_TABS: AppTab[] = [
  { route: "app", labelKey: "app.tab.dashboard" },
  {
    route: "appAnalytics",
    labelKey: "app.tab.analytics",
    unlockedBy: (instance) => collects(instance, "beacon"),
  },
  {
    route: "appVitals",
    labelKey: "app.tab.vitals",
    unlockedBy: (instance) => collects(instance, "beacon"),
  },
  // Not beacon: this one reads `sigil_error_groups`, which is written under the
  // `blights` kind. The two are genuinely independent - see the route's note.
  {
    route: "appErrors",
    labelKey: "app.tab.errors",
    unlockedBy: (instance) => collects(instance, "blights"),
  },
  // Last of the four on purpose. Analytics and Vitals answer the questions
  // worth putting on a page; this one answers the ones nobody anticipated, so
  // it belongs after the curated pair rather than in place of them.
  {
    route: "appExplore",
    labelKey: "app.tab.explore",
    unlockedBy: (instance) => collects(instance, "beacon"),
  },
  // Unconditional: builds come from CI through `lore artifacts push`, not from
  // what the instance collects, so an instance with no sigil still has a build
  // history.
  //
  // ⚠️ Artifacts belong to the APP, so every instance of `club` shows the
  // identical list and nothing on screen says why. Carried knowingly: on an
  // instance page the list reads as "what can I deploy here", and a badge
  // explaining the difference would be a control that changes nothing.
  { route: "appArtifacts", labelKey: "app.tab.artifacts" },
  { route: "appSettings", labelKey: "app.tab.settings" },
];

/**
 * Whether this instance's credential is allowed to collect one kind.
 *
 * `false` for an instance with no sigil at all, which is the normal state right
 * after creation rather than a fault.
 */
const collects = (instance: AppInstanceResource, kind: string): boolean =>
  instance.sigil?.kinds.includes(kind) ?? false;

/**
 * The tabs this instance has, in order.
 */
export const appTabsFor = (instance: AppInstanceResource): AppTab[] =>
  APP_TABS.filter((tab) => !tab.unlockedBy || tab.unlockedBy(instance));
