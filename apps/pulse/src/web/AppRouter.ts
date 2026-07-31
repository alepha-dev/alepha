import { $hook, $inject, Alepha, z } from "alepha";
import type { RealmController } from "alepha/api/users";
import { $page, ReactRouter, Redirection } from "alepha/react/router";
import { HttpError } from "alepha/server";
import { $client } from "alepha/server/links";
import type { AppDetailController } from "../api/controllers/AppDetailController.ts";
import type { PulseAppController } from "../api/controllers/PulseAppController.ts";

export class AppRouter {
  protected readonly alepha = $inject(Alepha);
  protected readonly router = $inject(ReactRouter);
  protected readonly appsApi = $client<PulseAppController>();
  protected readonly detailApi = $client<AppDetailController>();
  protected readonly realmApi = $client<RealmController>();

  layout = $page({
    // A thunk, not an array: field initializers run top to bottom, so naming
    // `this.home` directly here would capture `undefined`.
    children: () => [this.home, this.app, this.login],
    lazy: () => import("./components/Layout.tsx"),
    errorHandler: (error: unknown, state) => {
      if (HttpError.is(error, 401) && state.url.pathname !== "/auth/login") {
        return new Redirection(
          `/auth/login?redirect=${encodeURIComponent(
            state.url.pathname + state.url.search,
          )}`,
        );
      }
      return;
    },
  });

  home = $page({
    path: "/",
    name: "home",
    head: { title: "Apps › Pulse" },
    lazy: () => import("./components/AppsPage.tsx"),
    loader: async () => ({ apps: await this.appsApi.list() }),
  });

  /**
   * One app's insights.
   *
   * View and window live in the query so switching either is a navigation the
   * back button understands — and so a link to "the errors of the last 30
   * days" is a link somebody can send.
   */
  app = $page({
    path: "/apps/:slug",
    name: "app",
    head: { title: "Insights › Pulse" },
    lazy: () => import("./components/AppDetailPage.tsx"),
    schema: {
      params: z.object({ slug: z.text() }),
      query: z.object({
        view: z.text({ default: "analytics" }),
        days: z.text({ default: "7" }),
      }),
    },
    loader: async ({ params, query }) => {
      const days = Number(query.days) || 7;
      const [overview, analytics, errors] = await Promise.all([
        this.detailApi.overview({ params: { slug: params.slug } }),
        this.detailApi.analytics({
          params: { slug: params.slug },
          query: { days },
        }),
        this.detailApi.errorList({ params: { slug: params.slug } }),
      ]);
      return {
        slug: params.slug,
        view: query.view,
        days,
        overview,
        analytics,
        errors,
      };
    },
  });

  login = $page({
    path: "/auth/login",
    name: "login",
    head: { title: "Sign in › Pulse" },
    lazy: () => import("./components/AuthLoginPage.tsx"),
    loader: async () => ({
      realmConfig: await this.realmApi.getRealmConfig(),
    }),
  });

  onFetchError = $hook({
    on: "client:onError",
    handler: async ({ error }: { error: unknown }) => {
      const loginPath = this.router.path("login");
      if (
        this.alepha.isBrowser() &&
        HttpError.is(error, 401) &&
        this.router.state.url.pathname !== loginPath
      ) {
        await this.router.push(loginPath, {
          query: {
            redirect:
              this.router.state.url.pathname + this.router.state.url.search,
          },
        });
      }
    },
  });
}
