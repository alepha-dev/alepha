import { $hook, $inject, Alepha } from "alepha";
/*
 * `react:transition:end` is declared there. Type-only and therefore erased, so
 * this subpath imports no React: a module that only wants the numbers can use
 * it without bringing in the router.
 */
import type {} from "alepha/react/router";
import { WebVitalsCollector } from "alepha/vitals";

/**
 * Reports Core Web Vitals per page, as events: `react:vital:measured` for each
 * finalised metric, and `react:lcp:painted` when the main content has painted.
 *
 * Opt-in: inject it from what consumes the events. It is not one of the
 * router's services, or every app would run five observers, one of them with a
 * `durationThreshold` of 16 ms.
 *
 * ```ts
 * class Vitals {
 *   provider = $inject(ReactVitalsProvider);
 *
 *   measured = $hook({
 *     on: "react:vital:measured",
 *     handler: ({ metric, value, path }) => {
 *       navigator.sendBeacon("/vitals", JSON.stringify({ metric, value, path }));
 *     },
 *   });
 * }
 * ```
 */
export class ReactVitalsProvider {
  protected readonly alepha = $inject(Alepha);

  /**
   * The page on screen, as the router sees it. LCP, CLS and INP are finalised
   * when the tab is hidden, and by then `location` names whatever page the
   * visitor moved on to.
   */
  protected path?: string;

  protected readonly onTransitionEnd = $hook({
    on: "react:transition:end",
    handler: ({ state }) => {
      this.path = (state.overlay?.url ?? state.url).pathname;
    },
  });

  protected readonly observe = $hook({
    on: "ready",
    handler: () => {
      if (typeof window === "undefined") {
        return;
      }

      new WebVitalsCollector(
        (vital) => {
          void this.alepha.events.emit("react:vital:measured", vital);
        },
        () => {
          void this.alepha.events.emit("react:lcp:painted", {});
        },
        () => this.path ?? location.pathname,
      ).observe();
    },
  });
}
