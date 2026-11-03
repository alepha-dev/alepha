import { $hook, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { BrowserHeadProvider } from "alepha/react/head";
import { type Route, RouterProvider } from "alepha/router";
import { createElement, type ReactNode } from "react";

import NotFoundPage from "../components/NotFound.tsx";
import { Redirection } from "../errors/Redirection.ts";
import { ReactPrefetchCache } from "../services/ReactPrefetchCache.ts";
import {
  type CreateLayersResult,
  isPageRoute,
  type PageRoute,
  type PageRouteEntry,
  type PreviousLayerData,
  ReactPageProvider,
  type ReactRouterState,
} from "./ReactPageProvider.ts";
import { RouterLocaleProvider } from "./RouterLocaleProvider.ts";

export interface BrowserRoute extends Route {
  page: PageRoute;
}

export interface RouterTransitionOptions {
  /**
   * The target may open as an overlay.
   */
  overlay?: boolean;
  /**
   * The target may use what a prefetch loaded.
   */
  prefetched?: boolean;
}

/**
 * Implementation of AlephaRouter for React in browser environment.
 */
export class ReactBrowserRouterProvider extends RouterProvider<BrowserRoute> {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly pageApi = $inject(ReactPageProvider);
  protected readonly browserHeadProvider = $inject(BrowserHeadProvider);
  protected readonly localeProvider = $inject(RouterLocaleProvider);
  protected readonly prefetchCache = $inject(ReactPrefetchCache);

  public add(entry: PageRouteEntry) {
    this.pageApi.add(entry);
  }

  protected readonly configure = $hook({
    on: "configure",
    handler: async () => {
      for (const page of this.pageApi.getPages()) {
        // mount only if a view is provided
        if (page.component || page.lazy || page.redirect) {
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
    isStale: () => boolean = () => false,
    options: RouterTransitionOptions = {},
  ): Promise<string | undefined> {
    const { pathname, search } = url;
    const committed = this.alepha.store.get("alepha.react.router.state");
    let opensOverlay = false;

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
      // In locale-prefix mode the URL is the source of truth for language:
      // strip a leading `/fr`-style segment and remember it (the i18n module
      // reacts to this to switch dictionaries), then match on the canonical
      // path so the single page tree still resolves. `state.url` keeps the
      // full prefixed URL so generated links carry the prefix forward.
      let matchPathname = pathname;
      if (this.localeProvider.enabled) {
        matchPathname = this.localeProvider.adopt(pathname);
      }

      const { route, params } = this.match(matchPathname);

      const query: Record<string, string> = {};
      if (search) {
        for (const [key, value] of new URLSearchParams(search).entries()) {
          query[key] = String(value);
        }
      }

      // NOTE: `page.can` is a UI-affordance predicate (sidebar visibility),
      // NOT a route guard — real access control is `use: [$secure(...)]`.
      // The router intentionally does not block routing on it.

      state.name = route?.page.name;
      state.query = query;
      state.params = params ?? {};

      if (isPageRoute(route)) {
        opensOverlay =
          !!options.overlay &&
          this.pageApi.canOverlay(route.page, state.params, committed);

        // A click right behind its own hover: the requests are already out.
        if (options.prefetched) {
          await this.prefetchCache.settled(pathname + search);
        }

        const { redirect } = opensOverlay
          ? await this.openOverlay(route.page, state, committed!, options)
          : await this.pageApi.createLayers(route.page, state, previous, {
              prefetched: options.prefetched,
            });

        opensOverlay = opensOverlay && !state.layers.some((it) => it.error);
        // A newer navigation already won — bail before committing or
        // emitting any further events. The caller (ReactBrowserProvider)
        // also re-checks staleness, but stopping here avoids running
        // success hooks for a transition the user no longer wants.
        if (isStale()) {
          return;
        }
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
      // If we were superseded mid-flight, swallow the error: the user has
      // already moved on, and an error UI for an abandoned page would
      // overwrite the newer page they actually want.
      if (isStale()) {
        return;
      }

      this.log.error("Transition has failed", e);

      let element: ReactNode | undefined;
      try {
        const result = state.onError(e as Error, state);
        if (result != null && !(result instanceof Redirection)) {
          element = result as ReactNode;
        }
      } catch {
        // error handler itself failed, fall through to default
      }

      opensOverlay = false;
      state.layers = [
        {
          name: "error",
          element: element ?? this.pageApi.renderError(e as Error),
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

    // Final supersession check before any side effects (onLeave/onEnter,
    // store mutation, head rewrite). Stale transitions must be a complete
    // no-op from this point on.
    if (isStale()) {
      return;
    }

    // An overlay has one page of its own, its leaf, compared apart from the
    // background's layers: the board's `onLeave` must not fire when a card
    // opens, and the card's must fire when it closes.
    const overlayName = opensOverlay ? state.name : undefined;
    if (committed?.overlay && committed.overlay.name !== overlayName) {
      this.pageApi.findRoute(committed.overlay.name)?.onLeave?.();
    }
    if (overlayName && committed?.overlay?.name !== overlayName) {
      this.pageApi.findRoute(overlayName)?.onEnter?.();
    }

    if (!opensOverlay) {
      // [feature]: local hook for leaving a page
      for (let i = 0; i < previous.length; i++) {
        const layer = previous[i];
        if (state.layers[i]?.name !== layer.name && layer.name !== "error") {
          this.pageApi.findRoute(layer.name)?.onLeave?.();
        }
      }

      // [feature]: local hook for entering a page
      for (let i = 0; i < state.layers.length; i++) {
        const layer = state.layers[i];
        if (previous?.[i]?.name !== layer.name && layer.name !== "error") {
          this.pageApi.findRoute(layer.name)?.onEnter?.();
        }
      }
    }

    const next = opensOverlay ? this.overBackground(state, committed!) : state;

    this.alepha.store.set("alepha.react.router.state", next);

    await this.alepha.events.emit("react:action:end", {
      type: "transition",
    });
    await this.alepha.events.emit("react:transition:end", {
      state: next,
    });

    // Fill and render head from route configurations. The target's, overlay
    // included: the tab names what the URL names.
    this.browserHeadProvider.fillAndRenderHead(state);
  }

  /**
   * The overlay's layers, on the ones its parents hold on screen.
   *
   * A loader that fails has no business rendering in a floating root view, so
   * the page is built again in full, where `errorHandler` expects to land.
   */
  protected async openOverlay(
    page: PageRoute,
    state: ReactRouterState,
    committed: ReactRouterState,
    options: RouterTransitionOptions,
  ): Promise<CreateLayersResult> {
    const result = await this.pageApi.createLayers(
      page,
      state,
      committed.layers,
      { overlay: true, prefetched: options.prefetched },
    );

    if (!state.layers.some((it) => it.error)) {
      return result;
    }

    state.layers = [];
    return this.pageApi.createLayers(page, state, committed.layers);
  }

  /**
   * The state an overlay commits: the background's, with the overlay beside
   * it. Every layer is marked reused, so no view moves.
   */
  protected overBackground(
    target: ReactRouterState,
    background: ReactRouterState,
  ): ReactRouterState {
    return {
      ...background,
      layers: background.layers.map((it) => ({ ...it, cache: true })),
      overlay: {
        name: target.name as string,
        url: target.url,
        params: target.params,
        query: target.query,
        layers: target.layers,
      },
    };
  }

  public root(state: ReactRouterState): ReactNode {
    return this.pageApi.root(state);
  }
}
