import { $ui, alephaSidebarAtom } from "@alepha/ui";
import { $uiAdmin } from "@alepha/ui/admin";
import { $uiAuth } from "@alepha/ui/auth";
import { $uiDemo } from "@alepha/ui/demo";
import { $page } from "alepha/react/router";
import { $cookie } from "alepha/server/cookies";
import { $client } from "alepha/server/links";
import type { HelloController } from "../api/controllers/HelloController.ts";

export class AppRouter {
  uiPref = $cookie(alephaSidebarAtom, {
    ttl: [1, "minute"],
  });

  api = $client<HelloController>();

  ui = $ui();

  uiAuth = $uiAuth();

  uiAdmin = $uiAdmin();

  uiDemo = $uiDemo();

  layout = $page({
    parent: this.ui.root,
    children: () => [this.home],
  });

  home = $page({
    path: "/",
    lazy: () => import("./components/Home.tsx"),
    loader: () => this.api.hello(),
  });
}
