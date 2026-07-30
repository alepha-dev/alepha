import { $hook, $inject, Alepha, z } from "alepha";
import type { RealmController } from "alepha/api/users";
import { $page, ReactRouter, Redirection } from "alepha/react/router";
import { HttpError } from "alepha/server";
import { $client } from "alepha/server/links";
import type { BayAppController } from "../api/controllers/BayAppController.ts";
import type { DeviceController } from "../api/controllers/DeviceController.ts";

export class AppRouter {
  protected readonly alepha = $inject(Alepha);
  protected readonly router = $inject(ReactRouter);
  protected readonly bayApi = $client<BayAppController>();
  protected readonly realmApi = $client<RealmController>();
  protected readonly deviceApi = $client<DeviceController>();

  layout = $page({
    // A thunk, not an array: field initializers run top to bottom, so naming
    // `this.home` directly here would capture `undefined`.
    children: () => [this.home, this.login, this.register, this.device],
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
      // `status` is fetched alongside the list so the page can tell "no Bay
      // configured" from "a Bay with no apps yet" — they look identical
      // otherwise, and only one of them is something the operator must fix.
      const [status, apps] = await Promise.all([
        this.bayApi.status(),
        this.bayApi.listApps(),
      ]);
      return { configured: status.configured, apps };
    },
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
   * Sign-up — the initial bootstrap only.
   *
   * `PULSE_ALLOW_REGISTRATION` gates the realm, not this route: with the flag
   * unset the realm refuses registration and the login page stops linking here.
   * Keeping the route mounted avoids a 404 on a link the realm itself rendered.
   */
  register = $page({
    path: "/auth/register",
    name: "register",
    head: { title: "Create the admin account › Bay" },
    lazy: () => import("./components/AuthRegisterPage.tsx"),
    loader: async () => ({
      realmConfig: await this.realmApi.getRealmConfig(),
    }),
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
