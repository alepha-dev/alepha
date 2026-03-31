import { IconTerminal2 } from "@tabler/icons-react";
import type { AdminJobController } from "alepha/api/jobs";
import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";

export class AdminJobRouter {
  protected readonly jobCtrl = $client<AdminJobController>();

  adminJobs = $page({
    icon: IconTerminal2,
    path: "/jobs",
    label: "Jobs",
    description: "Monitor and manage background jobs.",
    head: { title: "Jobs" },
    can: () => this.jobCtrl.getJobRegistry.can(),
    lazy: () => import("./components/AdminJobs.tsx"),
  });
}
