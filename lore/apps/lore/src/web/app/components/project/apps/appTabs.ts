import type { AppInstanceResource } from "@/api/schemas/appInstanceResourceSchema.ts";
import type { AppsCapabilityOptions } from "@/api/schemas/appsCapabilityOptionsSchema.ts";

export type AppTabRoute =
  | "app"
  | "appAnalytics"
  | "appVitals"
  | "appErrors"
  | "appExplore"
  | "appArtifacts"
  | "appEnvironment"
  | "appSettings";

export type AppTabLabelKey =
  | "app.tab.overview"
  | "app.tab.analytics"
  | "app.tab.vitals"
  | "app.tab.errors"
  | "app.tab.explore"
  | "app.tab.artifacts"
  | "app.tab.environment"
  | "app.tab.settings";

/**
 * Which switch inside the Apps capability a gated tab answers to.
 */
export type AppTabOption = keyof AppsCapabilityOptions;

/**
 * A tab, and the two gates it may stand behind.
 *
 * ⚠️ **A union rather than two optional fields**, so a gated tab cannot forget
 * to name its option and an ungated one cannot name one. That is not style:
 * the option used to be implicit and every gated tab inherited `apps.track`,
 * which would have hidden epic #1's Deploy tab from any project that deploys
 * through Lore with telemetry off. Making the omission a type error is what
 * stops the next tab repeating it.
 */
export type AppTab = UngatedAppTab | GatedAppTab;

export interface UngatedAppTab {
  route: AppTabRoute;
  labelKey: AppTabLabelKey;
  /**
   * The Apps baseline: always there, whatever the project switched on. True of
   * exactly three - Overview, Artifacts and Settings - and that is the set
   * `appsCapabilityOptionsSchema` calls the baseline.
   */
  unlockedBy?: undefined;
  option?: undefined;
}

export interface GatedAppTab {
  route: AppTabRoute;
  labelKey: AppTabLabelKey;
  /**
   * What the instance must have unlocked for this tab to exist.
   *
   * A predicate rather than a set of booleans, because the two axes are not
   * the same question: `sigilId` is presence, and `kinds` is what that
   * credential is allowed to collect. `beacon` fills the view and vitals
   * datasets, `blights` fills the error groups, and an instance can carry
   * either without the other.
   */
  unlockedBy: (instance: AppInstanceResource) => boolean;
  /**
   * The project switch above that predicate. `track` for the telemetry four;
   * epic #1's Deploy tab and #1813's Environment tab name their own.
   */
  option: AppTabOption;
}

/**
 * The tab set of an instance page, in the order it is drawn.
 *
 * ⚠️ **Data, not a hand-written sequence**, and that is the point of the file.
 * Environment arrived as one entry with an `unlockedBy` of its own, and epic
 * #1's Deploy tab arrives the same way; neither rewrites the bar to do it.
 *
 * ⚠️ **The seam and the screen ship together.** Environment is a security
 * surface, so no placeholder tab ever stood here: a tab in place invites
 * somebody to fill it in before the crypto exists, and #1813 landed the entry,
 * the sealed column and the page in one commit.
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
  { route: "app", labelKey: "app.tab.overview" },
  {
    route: "appAnalytics",
    labelKey: "app.tab.analytics",
    unlockedBy: (instance) => collects(instance, "beacon"),
    option: "track",
  },
  {
    route: "appVitals",
    labelKey: "app.tab.vitals",
    unlockedBy: (instance) => collects(instance, "beacon"),
    option: "track",
  },
  // Not beacon: this one reads `sigil_error_groups`, which is written under the
  // `blights` kind. The two are genuinely independent - see the route's note.
  {
    route: "appErrors",
    labelKey: "app.tab.errors",
    unlockedBy: (instance) => collects(instance, "blights"),
    option: "track",
  },
  // Last of the four on purpose. Analytics and Vitals answer the questions
  // worth putting on a page; this one answers the ones nobody anticipated, so
  // it belongs after the curated pair rather than in place of them.
  {
    route: "appExplore",
    labelKey: "app.tab.explore",
    unlockedBy: (instance) => collects(instance, "beacon"),
    option: "track",
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
  // ⚠️ `deploy`, never `track`. A project that deploys through Lore with
  // telemetry off must not lose the screen holding its production credentials
  // for a reason nothing on the page explains, which is the trap `AppTab`'s
  // union was made to close.
  //
  // Unlocked by having an estate: the variables reach the app through a deploy,
  // and a copy with nowhere to deploy has nothing to configure yet. Choosing an
  // estate on the Settings tab is what makes this tab appear.
  {
    route: "appEnvironment",
    labelKey: "app.tab.environment",
    unlockedBy: (instance) => !!instance.estateId,
    option: "deploy",
  },
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
 * The tabs this instance has, in order, given the project's Apps options.
 *
 * ⚠️ **Two gates, one above the other, and the upper one is per tab.** The
 * project's option - `track` for the telemetry four, and whatever a later tab
 * names - decides whether this project has that surface at all; the instance's
 * own predicate decides whether THIS copy unlocked it. The project switch sits
 * above, so turning tracking off takes the telemetry tabs from every instance
 * at once without touching a single sigil, and turning it back on returns
 * exactly the tabs each instance had.
 *
 * ⚠️ The upper gate is **not** `apps.track` for every gated tab. It was, and a
 * project with `deploy` on and `track` off would have lost epic #1's Deploy tab
 * with nothing on screen saying why; `AppTab` now makes each tab name its own.
 *
 * Overview, Artifacts and Settings are the baseline and answer to neither.
 *
 * An absent `options` means no project narrowing at all, which is what a unit
 * test wants. A bag that IS passed is read strictly - a missing key is off -
 * because the rule everywhere else in `projectCapabilities` is narrow, never
 * widen.
 *
 * ⚠️ A UI affordance and not the security boundary: #1205 refuses server-side,
 * and a hidden tab refuses nothing.
 */
export const appTabsFor = (
  instance: AppInstanceResource,
  options?: Partial<AppsCapabilityOptions>,
): AppTab[] => appTabsFrom(APP_TABS, instance, options);

/**
 * The same filter over a tab list given by the caller.
 *
 * It exists so the rule can be exercised against a tab whose option is NOT
 * `track` while the only such tabs are still unwritten - epic #1's Deploy and
 * #1813's Environment. Testing the rule only through `APP_TABS` would test a
 * set in which every gated tab happens to answer to `track`, which is exactly
 * the coincidence that hid the bug.
 */
export const appTabsFrom = (
  tabs: AppTab[],
  instance: AppInstanceResource,
  options?: Partial<AppsCapabilityOptions>,
): AppTab[] =>
  tabs.filter(
    (tab) =>
      !tab.unlockedBy ||
      ((options ? options[tab.option] === true : true) &&
        tab.unlockedBy(instance)),
  );
