import { $page } from "alepha/react/router";

import { Layout } from "./Layout.tsx";

/**
 * Every route in the demo: one page of its own.
 *
 * `AuthRouter` and `AdminRouter` are registered as services in `./index.ts`
 * and mount themselves at the root (`/auth/*` and `/admin`), so they are
 * absent here. The account is a dialog over the page (`AccountDialog`),
 * drawn by this layout's `DialogProvider`.
 */
export class AppRouter {
  layout = $page({
    component: Layout,
    children: (): any[] => [this.home],
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
