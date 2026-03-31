import { IconDevices } from "@tabler/icons-react";
import type { AdminSessionController } from "alepha/api/users";
import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";

export class AdminSessionRouter {
  protected readonly sessionCtrl = $client<AdminSessionController>();

  adminSessions = $page({
    icon: IconDevices,
    path: "/sessions",
    label: "Sessions",
    description: "View and manage all active sessions.",
    head: { title: "Sessions" },
    can: () => this.sessionCtrl.findSessions.can(),
    lazy: () => import("./components/AdminSessions.tsx"),
  });
}
