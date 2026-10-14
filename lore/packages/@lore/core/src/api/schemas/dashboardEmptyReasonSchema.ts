import { type Infer, z } from "alepha";

/**
 * Why a metric has nothing to show: the data gate of epic #E77 (folio #F1364).
 *
 * A code, never copy: each one is `dashboard.empty.<code>` in the locales.
 *
 * - `noData`: the generic answer, the scope holds nothing this metric counts.
 * - `noEpic` / `noRelease`: the option is on and there is no epic or release
 *   (or none with quests) to measure.
 * - `noSigil`: no app reports to this project.
 * - `noBeacon`: apps report, none of them reports page views.
 * - `silent`: an app exists and has not reported in 30 days.
 * - `noFolio`: a Knowledge tile in a project with no folio.
 * - `noActivity`: nothing happened in the window.
 * - `noQuests`: the reader holds no open quest, or the project has none.
 * - `noAccess`: the reader lacks the permission the metric `requires`.
 */
export const dashboardEmptyReasonSchema = z.enum([
  "noData",
  "noEpic",
  "noRelease",
  "noSigil",
  "noBeacon",
  "silent",
  "noFolio",
  "noActivity",
  "noQuests",
  "noAccess",
]);

export type DashboardEmptyReason = Infer<typeof dashboardEmptyReasonSchema>;
