import { $hook, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { BrowserHeadProvider } from "alepha/react/head";
import { type Route, RouterProvider } from "alepha/router";
import { createElement, type ReactNode } from "react";
import NotFoundPage from "../components/NotFound.tsx";
import {
  isPageRoute,
  type PageRoute,
  type PageRouteEntry,
  type PreviousLayerData,
  ReactPageProvider,
  type ReactRouterState,
} from "./ReactPageProvider.ts";

export interface BrowserRoute extends Route {
  page: PageRoute;
}

/**
 * Implementation of AlephaRouter for React in browser environment.
 */
export class ReactBrowserRouterProvider extends RouterProvider<BrowserRoute> {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly pageApi = $inject(ReactPageProvider);
  protected readonly browserHeadProvider = $inject(BrowserHeadProvider);

  public add(entry: PageRouteEntry) {
    this.pageApi.add(entry);
  }

  protected readonly configure = $hook({
    on: "configure",
    handler: async () => {
      for (const page of this.pageApi.getPages()) {
        // mount only if a view is provided
        if (page.component || page.lazy) {
          this.push({
            path: page.match,
            page,
          });
        }
      }
    },
  });

  public async transition(
    url: URL,
    previous: PreviousLayerData[] = [],
    meta = {},
  ): Promise<string | void> {
    const { pathname, search } = url;

    const entry: Partial<ReactRouterState> = {
      url,
      query: {},
      params: {},
      layers: [],
      onError: () => null,
      meta,
    };

    const state = entry as ReactRouterState;

    // Emit both action and transition events
    await this.alepha.events.emit("react:action:begin", {
      type: "transition",
    });
    await this.alepha.events.emit("react:transition:begin", {
      previous: this.alepha.store.get("alepha.react.router.state")!,
      state,
    });

    try {
      const { route, params } = this.match(pathname);

      const query: Record<string, string> = {};
      if (search) {
        for (const [key, value] of new URLSearchParams(search).entries()) {
          query[key] = String(value);
        }
      }

      state.name = route?.page.name;
      state.query = query;
      state.params = params ?? {};

      if (isPageRoute(route)) {
        const { redirect } = await this.pageApi.createLayers(
          route.page,
          state,
          previous,
        );
        if (redirect) {
          return redirect;
        }
      }

      if (state.layers.length === 0) {
        state.layers.push({
          name: "not-found",
          element: createElement(NotFoundPage),
          index: 0,
          path: "/",
        });
      }

      await this.alepha.events.emit("react:action:success", {
        type: "transition",
      });
      await this.alepha.events.emit("react:transition:success", { state });
    } catch (e) {
      this.log.error("Transition has failed", e);
      state.layers = [
        {
          name: "error",
          element: this.pageApi.renderError(e as Error),
          index: 0,
          path: "/",
        },
      ];

      await this.alepha.events.emit("react:action:error", {
        type: "transition",
        error: e as Error,
      });
      await this.alepha.events.emit("react:transition:error", {
        error: e as Error,
        state,
      });
    }

    // [feature]: local hook for leaving a page
    if (previous) {
      for (let i = 0; i < previous.length; i++) {
        const layer = previous[i];
        if (state.layers[i]?.name !== layer.name) {
          this.pageApi.page(layer.name)?.onLeave?.();
        }
      }
    }

    this.alepha.store.set("alepha.react.router.state", state);

    await this.alepha.events.emit("react:action:end", {
      type: "transition",
    });
    await this.alepha.events.emit("react:transition:end", {
      state,
    });

    // Fill and render head from route configurations
    this.browserHeadProvider.fillAndRenderHead(state);
  }

  public root(state: ReactRouterState): ReactNode {
    return this.pageApi.root(state);
  }
}
