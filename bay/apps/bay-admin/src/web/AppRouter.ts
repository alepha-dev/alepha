import { $hook, $inject, Alepha, z } from "alepha";
import type { RealmController } from "alepha/api/users";
import { $page, ReactRouter, Redirection } from "alepha/react/router";
import { HttpError } from "alepha/server";
import { $client } from "alepha/server/links";
import type { AppDetailController } from "../api/controllers/AppDetailController.ts";
import type { BayAppController } from "../api/controllers/BayAppController.ts";
import type { DeviceController } from "../api/controllers/DeviceController.ts";

export class AppRouter {
  protected readonly alepha = $inject(Alepha);
  protected readonly router = $inject(ReactRouter);
  protected readonly bayApi = $client<BayAppController>();
  protected readonly realmApi = $client<RealmController>();
  protected readonly deviceApi = $client<DeviceController>();
  protected readonly detailApi = $client<AppDetailController>();

  layout = $page({
    // A thunk, not an array: field initializers run top to bottom, so naming
    // `this.home` directly here would capture `undefined`.
    children: () => [
      this.home,
      this.app,
      this.login,
      this.profile,
      this.device,
    ],
    lazy: () => import("./components/Layout.tsx"),
    errorHandler: (error: unknown, state) => {
      // Every page below requires an admin session. Send an unauthenticated
      // visitor to the login form rather than rendering an error they cannot
      // act on.
      if (HttpError.is(error, 401) && state.url.pathname !== "/auth/login") {
        // Query included, not just the path: `/device?user_code=…` is the one
        // destination people arrive at by clicking a link, and dropping the
        // code sends them back to their terminal to retype it.
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
    head: { title: "Apps › Bay" },
    lazy: () => import("./components/AppsPage.tsx"),
    loader: async () => {
      // `status` first, and the list only if it answered.
      //
      // Fetching both together was the point of `status` — telling "no Bay
      // configured" from "a Bay with no apps yet" — but `listApps` throws when
      // the socket is unreachable, and a throwing loader means the page never
      // renders. The operator got a stack trace where the page had a written
      // explanation of exactly this situation waiting for them.
      const status = await this.bayApi.status();
      if (!status.configured) {
        return { configured: false, apps: [] };
      }
      return { configured: true, apps: await this.bayApi.listApps() };
    },
  });

  /**
   * One app's page. The tab lives in the query rather than the path so that
   * switching tabs is a navigation the browser's back button understands.
   */
  app = $page({
    path: "/apps/:slug",
    name: "app",
    head: { title: "App › Bay" },
    lazy: () => import("./components/AppDetailPage.tsx"),
    schema: {
      params: z.object({ slug: z.text() }),
      query: z.object({ tab: z.text({ default: "overview" }) }),
    },
    loader: async ({ params, query }) => ({
      slug: params.slug,
      tab: query.tab,
      overview: await this.detailApi.overview({
        params: { slug: params.slug },
      }),
    }),
  });

  login = $page({
    path: "/auth/login",
    name: "login",
    head: { title: "Sign in › Bay" },
    lazy: () => import("./components/AuthLoginPage.tsx"),
    loader: async () => ({
      realmConfig: await this.realmApi.getRealmConfig(),
    }),
  });

  /**
   * The operator's own account — a password change, and nothing else.
   *
   * There is no sign-up route to pair it with: this realm creates exactly one
   * account, at first boot, and an open form on an infrastructure panel would
   * be a way in rather than a convenience.
   */
  profile = $page({
    path: "/profile",
    name: "profile",
    head: { title: "Profile › Bay" },
    lazy: () => import("./components/ProfilePage.tsx"),
  });

  /**
   * Approves a terminal waiting on the device grant.
   *
   * Under the layout, so an unauthenticated visitor is sent to sign in first:
   * the whole point of this page is that an authenticated human decides.
   */
  device = $page({
    path: "/device",
    name: "device",
    head: { title: "Approve a terminal › Bay" },
    lazy: () => import("./components/DevicePage.tsx"),
    schema: {
      query: z.object({ user_code: z.text({ default: "" }) }),
    },
    // Pre-filled from `verification_uri_complete` so anyone who can follow a
    // link is spared retyping the code.
    //
    // The lookup runs in the loader, not on submit: it is admin-guarded, so an
    // unauthenticated visitor is redirected while still on the way in and comes
    // back with the code intact.
    loader: async ({ query }) => ({
      userCode: query.user_code,
      initialStatus: (
        await this.deviceApi.lookup({ query: { userCode: query.user_code } })
      ).status,
    }),
  });

  /**
   * Push an expired session back to the login form instead of letting a page
   * fail silently mid-navigation.
   */
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
