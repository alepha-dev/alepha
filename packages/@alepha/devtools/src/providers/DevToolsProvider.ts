import { $hook, $inject } from "alepha";
import { InspectorRoutes } from "alepha/inspector";
import { $logger } from "alepha/logger";
import { ServerProvider, ServerRouterProvider } from "alepha/server";
import { $serve } from "alepha/server/static";

import { devtoolsAssets } from "../assets.ts";

/**
 * The in-app devtools: the UI at `/__devtools`, and the inspector's routes
 * mounted under `/__devtools/api` for it to call.
 */
export class DevToolsProvider {
  protected readonly log = $logger();
  protected readonly serverProvider = $inject(ServerProvider);
  protected readonly serverRouter = $inject(ServerRouterProvider);
  protected readonly inspectorRoutes = $inject(InspectorRoutes);

  protected readonly onStart = $hook({
    on: "start",
    handler: () => {
      this.log.info("Devtools OK", {
        url: `${this.serverProvider.hostname}/__devtools/`,
      });
    },
  });

  protected readonly uiRoute = $serve({
    path: "/__devtools",
    root: devtoolsAssets.ui,
    historyApiFallback: true,
    silent: true,
  });

  /**
   * The inspector's route table, mounted on the app server.
   *
   * The table itself lives in `alepha/inspector` and does not know about
   * `$route`; this adapter is what keeps the in-app UI working until the
   * standalone devtools app replaces it and the table is reachable through
   * the inspector's socket only. The server validates and serializes against
   * each route's own schema, exactly as it did when these were `$route`s.
   */
  protected readonly mounted = this.mount();

  protected mount(): number {
    const routes = this.inspectorRoutes.list();
    for (const route of routes) {
      this.serverRouter.createRoute({
        method: route.method,
        path: `/__devtools/api${route.path}`,
        silent: true,
        schema: route.schema,
        handler: ({ params, query, body }: any) =>
          route.handler({ params, query, body }),
      });
    }
    return routes.length;
  }
}
