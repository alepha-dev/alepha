import { $hook, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";

import type { ReactRouterState } from "./ReactPageProvider.ts";

/**
 * Browser specific React renderer (react-dom/client interface)
 */
export class ReactBrowserRendererProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected root?: Root;

  /**
   * Stamped on `<html>` once React has taken over the server-rendered DOM.
   *
   * It exists for end-to-end tests, which otherwise have nothing to wait on
   * between "the document loaded" and "the app is interactive" and reach for a
   * fixed sleep instead. A sleep is both slower than it needs to be and flaky
   * under load; this is the condition those tests actually mean.
   *
   * Set only on the hydration path: on a client-rendered boot there is no
   * server HTML to take over, and the app's own markup appearing is already
   * the signal.
   *
   * ⚠️ It means "the hydrating render returned", which is the same claim the
   * `Hydrated root element` log line makes. Alepha resolves a route's layers
   * before rendering, so that render is not suspended and React flushes it
   * synchronously — but a tree that DOES suspend during hydration would set
   * this while part of it is still server HTML.
   */
  static readonly HYDRATED_ATTRIBUTE = "data-alepha-hydrated";

  protected readonly onBrowserRender = $hook({
    on: "react:browser:render",
    handler: async ({ hydration, root, element, state }) => {
      if (hydration?.["alepha.react.router.layers"]) {
        this.root = hydrateRoot(root, element, {
          onRecoverableError: (error, errorInfo) =>
            this.onRecoverableError(error, errorInfo, state),
        });
        document.documentElement.setAttribute(
          ReactBrowserRendererProvider.HYDRATED_ATTRIBUTE,
          "true",
        );
        this.log.info("Hydrated root element");
      } else {
        this.root ??= createRoot(root, {
          onRecoverableError: (error, errorInfo) =>
            this.onRecoverableError(error, errorInfo, state),
        });
        this.root.render(element);
        this.log.info("Created root element");
      }
    },
  });

  /**
   * What React recovered from, with enough context to act on it.
   *
   * ## Why the option is passed at all
   *
   * Without it React installs its own handler, which calls `reportError` —
   * so the error reaches `window.onerror` and any crash reporter listening
   * there, **stripped**. A production hydration mismatch arrives as the
   * minified code `#418` with its arguments blanked (`args[]=HTML&args[]=`):
   * no route, no component, nothing to open. That is a report that costs
   * ingest and answers nothing, and it is what `apps/docs` had been emitting
   * daily.
   *
   * `errorInfo.componentStack` is the whole difference. React fills it even in
   * a production build, and it names the subtree that mismatched.
   *
   * ## Why nothing is re-thrown to `window.onerror`
   *
   * Passing this option REPLACES React's default, so the blank report stops on
   * its own. Calling `reportError` here as well would restore it beside the
   * useful one, and the two would not merge: a crash inbox fingerprints on the
   * stack, so one mismatch would open two rows, one of them the useless one.
   * The deliberate report is the report.
   *
   * `react:recoverable:error` is what carries it. A crash reporter listens for
   * that event rather than for `window.onerror`, and gets the component stack
   * with it — see `@alepha/lore`'s `SigilBrowserProvider`.
   *
   * ## What it does NOT mean
   *
   * Not "the page is broken". React recovered — for a hydration mismatch, by
   * re-rendering that subtree on the client — so the visitor sees a correct
   * page. It is a defect worth a report and never worth an error boundary.
   *
   * Nor is it hydration-only: a root keeps this handler for its whole life, so
   * an error a Suspense boundary retried past also arrives here. Hence the
   * name, and hence `createRoot` taking the same option — a client-rendered
   * app has the same blank-report problem and no hydration at all.
   */
  protected onRecoverableError(
    error: unknown,
    errorInfo: { componentStack?: string | null },
    state: ReactRouterState,
  ): void {
    const componentStack = errorInfo.componentStack ?? undefined;
    const path = state?.url?.pathname;

    this.log.error("React recovered from a render error", {
      error,
      path,
      route: state?.name,
      componentStack,
    });

    this.alepha.events
      .emit("react:recoverable:error", {
        error,
        componentStack,
        state,
      })
      .catch((err) => {
        // Never silently: a listener that throws would otherwise make the
        // report this handler exists to produce disappear.
        this.log.error("Failed to emit react:recoverable:error", {
          error: err,
        });
      });
  }
}
