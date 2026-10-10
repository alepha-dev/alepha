import { $pageAdmin } from "@alepha/ui/admin";
import { z } from "alepha";
import { $client } from "alepha/server/links";
import { Smartphone } from "lucide-react";
import { createElement } from "react";

import type { OtaAdminController } from "../ota-api/controllers/OtaAdminController.ts";

/**
 * The OTA back office, under `/admin/ota`, in its own nav group.
 *
 * Pages are code-split; the router itself is eager and server-rendered, so
 * its icon is a `createElement`, not JSX. `can` hides the entry from an
 * admin who cannot call the action the page loads: the server enforces the
 * permission on every action regardless.
 */
export class OtaAdminRouter {
  protected readonly api = $client<OtaAdminController>();

  public readonly otaApps = $pageAdmin({
    path: "/ota",
    head: { title: "Live updates" },
    nav: {
      label: "Live updates",
      labelKey: "ota.admin.nav",
      icon: createElement(Smartphone),
      group: "Live updates",
      groupKey: "ota.admin.navGroup",
      order: 200,
    },
    can: () => this.api.otaListApps.can(),
    lazy: () => import("./components/OtaApps.tsx"),
  });

  public readonly otaApp = $pageAdmin({
    path: "/ota/:id",
    head: { title: "Live update app" },
    schema: { params: z.object({ id: z.uuid() }) },
    can: () => this.api.otaGetApp.can(),
    loader: ({ params }) => ({ id: params.id }),
    lazy: () => import("./components/OtaAppDetail.tsx"),
  });
}
