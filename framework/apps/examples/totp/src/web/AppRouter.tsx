import { $page } from "alepha/react/router";

import { Layout } from "./Layout.tsx";

/**
 * Every route in the demo: one page of its own.
 *
 * `AuthRouter`, `AccountRouter` and `AdminRouter` are registered as services
 * in `./index.ts` and mount themselves at the root (`/auth/*`, `/account` and
 * `/admin`), so they are absent here. The account area is a root shell with
 * its own sidebar and a "Back to site" item; adopting it into this layout
 * would show every toast twice.
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
