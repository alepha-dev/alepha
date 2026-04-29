import { IconTerminal2 } from "@tabler/icons-react";
import { t } from "alepha";
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
    can: () => this.jobCtrl.listJobs.can(),
    lazy: () => import("./components/AdminJobsList.tsx"),
  });

  adminJobDetail = $page({
    path: "/jobs/:name",
    head: { title: "Job" },
    schema: {
      params: t.object({ name: t.text() }),
    },
    lazy: () => import("./components/AdminJobDetail.tsx"),
    loader: async ({ params }: { params: { name: string } }) => ({
      name: params.name,
    }),
  });
}
