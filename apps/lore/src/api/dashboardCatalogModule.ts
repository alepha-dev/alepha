import { $module } from "alepha";

import { DashboardMetricCatalog } from "./services/DashboardMetricCatalog.ts";

/**
 * The one service both runtimes need, in a module neither of them owns.
 *
 * `DashboardMetricCatalog` is the declarative half of the metric registry:
 * the server resolves cards against it, and the browser generates the
 * Add-card wizard from it. It is pure by design, so living on both sides
 * costs nothing.
 *
 * ⚠️ It cannot simply be listed in **both** `LoreApi.services` and
 * `LoreWebApp.services`, and the failure is worth recording because it
 * surfaces nowhere near its cause. `$module` tags each of its services with
 * a back-reference to the declaring module, and that tag is what makes
 * injecting a service pull its module in (the same mechanism by which a
 * `$repository` auto-wires `AlephaOrm`). Listing one class in two modules
 * makes the tag last-write-wins at import time — so registering `LoreApi`
 * would drag `LoreWebApp` in with it, and `LoreWebApp` imports
 * `AlephaSigil`. `main.server.ts` substitutes `SigilSinkProvider` in the
 * lines BETWEEN those two registrations, and the substitution then fails
 * with `TooLateSubstitutionError` naming a service the dashboard has nothing
 * to do with.
 *
 * A module of its own, imported by both, gives the tag one stable home and
 * no side effects on either side.
 */
export const LoreDashboardCatalog = $module({
  name: "lore.dashboard.catalog",
  services: [DashboardMetricCatalog],
});
