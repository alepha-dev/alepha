import { $pageAccount, AccountRouter } from "@alepha/ui/account";
import { $inject } from "alepha";
import { $client } from "alepha/server/links";
import { Server } from "lucide-react";
import { createElement } from "react";

import type { EstateController } from "../../../../api/controllers/EstateController.ts";

/**
 * Deploy's page in the account area: the estates the signed-in user owns
 * (#E75, #Q2624). Mounted under the framework's account layout by
 * `$pageAccount`, like core's `LoreAccountRouter`, so core lists no Deploy
 * page.
 */
export class DeployAccountRouter {
  protected readonly account = $inject(AccountRouter);
  protected readonly estateApi = $client<EstateController>();

  estates = $pageAccount({
    path: "/estates",
    name: "accountEstates",
    head: this.account.accountHead("Estates"),
    can: () => this.estateApi.listMyEstates.can(),
    nav: {
      label: "Estates",
      icon: createElement(Server),
      group: "Lore",
      order: 103,
    },
    lazy: () => import("./MyEstates.tsx"),
  });
}
