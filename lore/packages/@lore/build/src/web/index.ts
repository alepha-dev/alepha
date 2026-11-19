import { LoreCoreWeb } from "@lore/core/web";
import { $module } from "alepha";

import { BuildDashboardMetrics } from "../api/services/BuildDashboardMetrics.ts";
import { QualityNumericCatalog } from "../api/services/QualityNumericCatalog.ts";
import { BuildRouter } from "./app/BuildRouter.ts";
import { BuildShell } from "./app/shell/BuildShell.ts";

/**
 * The browser-safe half of `@lore/build`, Lore's fourth pillar: the Quality
 * pages moved from `@lore/ship` (#E162), and nothing new.
 *
 * Registered by BOTH entries, `main.server.ts` and `main.browser.ts`: the
 * server renders and the browser hydrates from the same page registry, so a
 * page known to one side only renders on the server and 404s after hydration.
 *
 * It imports another package's `./api` or `./mcp` as `import type` only:
 * a runtime import would bundle that package's server into the browser.
 *
 * @module
 */
export const LoreBuildWeb = $module({
  name: "lore.build.web",
  imports: [LoreCoreWeb],
  register(alepha) {
    alepha.with(BuildRouter);
    alepha.inject(BuildShell);
    alepha.inject(BuildDashboardMetrics);
    alepha.inject(QualityNumericCatalog);
  },
});

export { BuildRouter } from "./app/BuildRouter.ts";
export { BuildShell } from "./app/shell/BuildShell.ts";

/**
 * Build's router in the app's router registry (#Q3187).
 */
declare module "alepha/react/router" {
  interface Routers {
    loreBuild: BuildRouter;
  }
}
