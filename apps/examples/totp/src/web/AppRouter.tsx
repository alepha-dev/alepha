import { AccountRouter } from "@alepha/ui/components/account/account-router";
import { $inject } from "alepha";
import { $page } from "alepha/react/router";

import { Layout } from "./Layout.tsx";

/**
 * Every route in the demo: one page of its own, plus the account area.
 *
 * `AuthRouter` and `AdminRouter` are registered as services in `./index.ts` and
 * mount themselves at the root (`/auth/*` and `/admin`), so they are absent
 * here. `AccountRouter` is different: its `layout` is adopted into this shell
 * below, so `/account/*` keeps the header rather than rendering its own.
 */
export class AppRouter {
  /**
   * Injected so `this.account.layout` can be adopted as a child.
   *
   * Mounting it is also what reveals the account entry in `<ButtonUser />`:
   * that menu composes `AccountMenuItem`, which hides itself unless a route
   * named `account` is registered.
   */
  protected readonly account = $inject(AccountRouter);

  layout = $page({
    component: Layout,
    children: (): any[] => [this.home, this.account.layout],
  });

  home = $page({
    path: "/",
    head: {
      title: "Two-factor authentication · Alepha example",
      description:
        "A deployed example of TOTP two-factor authentication on an Alepha realm.",
    },
    lazy: () => import("./pages/Home.tsx"),
  });
}
