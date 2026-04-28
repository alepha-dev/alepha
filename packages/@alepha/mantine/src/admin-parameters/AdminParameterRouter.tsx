import { IconSettings } from "@tabler/icons-react";
import type { AdminParameterController } from "alepha/api/parameters";
import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";

export class AdminParameterRouter {
  protected readonly paramCtrl = $client<AdminParameterController>();

  adminParameters = $page({
    icon: IconSettings,
    path: "/parameters",
    label: "Parameters",
    description: "View and manage application parameters.",
    head: { title: "Parameters" },
    can: () => this.paramCtrl.getParameterTree.can(),
    lazy: () => import("./components/AdminParameters.tsx"),
    loader: async () => {
      const treeData = await this.paramCtrl.getParameterTree({});
      return { treeData };
    },
  });
}
