import { IconHistory } from "@tabler/icons-react";
import type { AdminAuditController } from "alepha/api/audits";
import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";

export class AdminAuditRouter {
  protected readonly auditCtrl = $client<AdminAuditController>();

  adminAudits = $page({
    icon: IconHistory,
    path: "/audits",
    label: "Audit Log",
    description: "View system-wide audit trail and activity logs.",
    head: { title: "Audit Logs" },
    can: () => this.auditCtrl.findAudits.can(),
    lazy: () => import("./components/AdminAudits.tsx"),
  });
}
