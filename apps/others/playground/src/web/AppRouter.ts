import { AdminAudits } from "@alepha/ui/components/admin/admin-audits";
import { AdminFiles } from "@alepha/ui/components/admin/admin-files";
import { AdminJobs } from "@alepha/ui/components/admin/admin-jobs";
import { AdminNotifications } from "@alepha/ui/components/admin/admin-notifications";
import { AdminParameters } from "@alepha/ui/components/admin/admin-parameters";
import { $page, Redirection } from "alepha/react/router";
import { Layout } from "./Layout.tsx";
import Dialogs from "./pages/demo/Dialogs.tsx";
import Toasts from "./pages/demo/Toasts.tsx";
import Audits from "./pages/playgrounds/Audits.tsx";
import Jobs from "./pages/playgrounds/Jobs.tsx";
import Notifications from "./pages/playgrounds/Notifications.tsx";

export class AppRouter {
  layout: any = $page({
    component: Layout,
    children: (): any[] => [
      this.home,
      this.playgroundJobs,
      this.playgroundNotifications,
      this.playgroundAudits,
      this.adminJobs,
      this.adminAudits,
      this.adminNotifications,
      this.adminFiles,
      this.adminParameters,
      this.demoToasts,
      this.demoDialogs,
    ],
  });

  home: any = $page({
    parent: this.layout,
    path: "/",
    loader: async () => {
      throw new Redirection("/resources/jobs");
    },
    component: () => null,
  });

  playgroundJobs: any = $page({
    parent: this.layout,
    path: "/playgrounds/jobs",
    head: { title: "Jobs playground" },
    component: Jobs,
  });

  playgroundNotifications: any = $page({
    parent: this.layout,
    path: "/playgrounds/notifications",
    head: { title: "Notifications playground" },
    component: Notifications,
  });

  playgroundAudits: any = $page({
    parent: this.layout,
    path: "/playgrounds/audits",
    head: { title: "Audits playground" },
    component: Audits,
  });

  adminJobs: any = $page({
    parent: this.layout,
    path: "/resources/jobs",
    head: { title: "Jobs" },
    component: AdminJobs,
  });

  adminAudits: any = $page({
    parent: this.layout,
    path: "/resources/audits",
    head: { title: "Audit log" },
    component: AdminAudits,
  });

  adminNotifications: any = $page({
    parent: this.layout,
    path: "/resources/notifications",
    head: { title: "Notifications" },
    component: AdminNotifications,
  });

  adminFiles: any = $page({
    parent: this.layout,
    path: "/resources/files",
    head: { title: "Files" },
    component: AdminFiles,
  });

  adminParameters: any = $page({
    parent: this.layout,
    path: "/resources/parameters",
    head: { title: "Parameters" },
    component: AdminParameters,
  });

  demoToasts: any = $page({
    parent: this.layout,
    path: "/demo/toasts",
    head: { title: "Toasts demo" },
    component: Toasts,
  });

  demoDialogs: any = $page({
    parent: this.layout,
    path: "/demo/dialogs",
    head: { title: "Dialogs demo" },
    component: Dialogs,
  });
}
