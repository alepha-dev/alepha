import { $hook, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { ServerHeadProvider } from "alepha/react/head";
import type { ServerRequest, ServerRoute } from "alepha/server";
import type { ReactNode } from "react";
import { PAGE_ROUTE, type PageServerRoute } from "../constants/PAGE_ROUTE.ts";
import { Redirection } from "../errors/Redirection.ts";
import {
  type PageRoute,
  ReactPageProvider,
  type ReactRouterState,
} from "./ReactPageProvider.ts";
import { ReactServerTemplateProvider } from "./ReactServerTemplateProvider.ts";

/**
 * Answers a browser navigation with an HTML error page instead of JSON.
 *
 * `ServerRouterProvider` serializes every error as JSON, which is the right
 * answer for an API and the wrong one for a hard navigation: the visitor gets
 * `{"status":503,…}` painted as text on a white background, with no styles, no
 * favicon and no way back.
 *
 * The router already renders a real error page for anything a *loader* or a
 * *component* throws — that path runs inside `createLayers`, which owns
 * `errorHandler`. What never reached it is everything thrown *around* the
 * render: `use:` middleware, and every `server:onRequest` hook. Those are not
 * exotic. `ServerNotReadyProvider` throws 503 while the app is still booting,
 * `ServerRateLimitProvider` throws 429, `ServerAuthProvider` throws 401 on a
 * stale token. All three land on a first-time visitor, and all three used to
 * answer with JSON.
 *
 * This provider closes that gap from the react side, on the hook the server
 * already offers for it: `errorHandler` emits `server:onError` first and stops
 * as soon as a listener has set a status. So `alepha/server` needs no change,
 * and an app that does not load the react router keeps the JSON behaviour
 * exactly as it is.
 *
 * Two conditions, both required:
 *
 * - **`Accept: text/html`.** A browser navigation asks for HTML; `fetch`,
 *   `$action` sub-requests, curl and health checks send a wildcard or
 *   `application/json` and keep getting JSON. A bare wildcard never counts —
 *   that is what every programmatic client sends.
 * - **React is loaded.** Guaranteed by construction: this provider ships with
 *   `alepha/react/router`, so an API-only app has no such listener.
 */
export class ReactServerErrorProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly pageApi = $inject(ReactPageProvider);
  protected readonly templateProvider = $inject(ReactServerTemplateProvider);
  protected readonly serverHeadProvider = $inject(ServerHeadProvider);

  public readonly onError = $hook({
    on: "server:onError",
    handler: async ({ request, route, error }) => {
      const { reply } = request;

      // Another listener already answered (a custom error page, a redirect).
      if (reply.status) {
        return;
      }

      if (!this.acceptsHtml(request.headers.accept)) {
        return;
      }

      try {
        await this.reply(request, route, error);
      } catch (renderError) {
        // Never let the error page's own failure replace the original error:
        // leaving the reply untouched falls through to the JSON branches,
        // which is a worse answer but still an answer.
        this.log.error("Failed to render the HTML error page", renderError);
      }
    },
  });

  /**
   * Does this caller want a document, or a payload?
   *
   * Matches `text/html` as an explicit entry only. A browser lists it first on
   * a top-level navigation, so the signal is exact — and the bare wildcard
   * that `fetch()` defaults to deliberately does not match.
   */
  protected acceptsHtml(accept?: string): boolean {
    if (!accept) {
      return false;
    }

    return accept
      .split(",")
      .some(
        (entry) => entry.split(";")[0].trim().toLowerCase() === "text/html",
      );
  }

  /**
   * Build the HTML answer and write it onto the reply.
   */
  protected async reply(
    request: ServerRequest,
    route: ServerRoute,
    error: Error,
  ): Promise<void> {
    const { reply } = request;
    const page = (route as ServerRoute & PageServerRoute)[PAGE_ROUTE];
    const state = this.createState(request, page);

    // A custom error component runs inside the app's container: `useRouter`,
    // `useRouterState` and `useI18n` all read from here, and the built-in
    // ErrorViewer's dev overlay calls `useRouterState()` itself.
    this.alepha.store.set("alepha.react.router.state", state);

    // The prod error card shows this as "Reference:", which is the only thread
    // between what the visitor sees and what the logs recorded.
    (error as Error & { requestId?: string }).requestId ??= request.requestId;

    const element = page
      ? this.resolveErrorElement(page, error, state)
      : undefined;

    // A page's `errorHandler` may answer a failure with a redirect rather than
    // a render. Legal here, unlike mid-stream: nothing has been flushed.
    if (element instanceof Redirection) {
      reply.redirect(element.redirect);
      return;
    }

    reply.status = this.resolveStatus(error);
    reply.headers["content-type"] = "text/html; charset=UTF-8";
    reply.body = await this.templateProvider.renderErrorDocument(error, {
      element: element ?? undefined,
      head: this.serverHeadProvider.resolveGlobalHead(),
    });
  }

  /**
   * Ask the page — and then its parents — for a custom error component.
   *
   * Same chain, same contract as a loader failure: return a `ReactNode` to
   * render it, a `Redirection` to leave, or nothing to fall through to the
   * built-in `ErrorViewer`. An `errorHandler` written for a failing loader
   * therefore also covers a rate limit or a guard on that same page, with no
   * second concept to learn.
   */
  protected resolveErrorElement(
    page: PageRoute,
    error: Error,
    state: ReactRouterState,
  ): ReactNode | Redirection | undefined {
    const errorHandler = this.pageApi.getErrorHandler(page);
    if (!errorHandler) {
      return undefined;
    }

    try {
      return errorHandler(error, state) ?? undefined;
    } catch (e) {
      if (e instanceof Redirection) {
        return e;
      }
      this.log.error("Page errorHandler threw while rendering an error", e);
      return undefined;
    }
  }

  /**
   * Minimal router state for a render that never got one.
   *
   * These errors happen instead of `createLayers`, so there are no layers and
   * no resolved props — only what the request itself already told us.
   */
  protected createState(
    request: ServerRequest,
    page: PageRoute | undefined,
  ): ReactRouterState {
    return {
      url: request.url,
      params: request.params ?? {},
      query: request.query ?? {},
      name: page?.name,
      onError: () => null,
      layers: [],
      meta: {},
      head: {},
    };
  }

  /**
   * The status the visitor should see, mirroring the JSON branches of
   * `ServerRouterProvider.errorHandler` so the two answers never disagree.
   */
  protected resolveStatus(error: Error): number {
    const status = (error as Error & { status?: unknown }).status;
    if (typeof status === "number" && status >= 200 && status <= 599) {
      return status;
    }
    return 500;
  }
}
