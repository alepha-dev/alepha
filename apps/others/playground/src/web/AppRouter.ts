import { $page, Redirection } from "alepha/react/router";
import { AdminAudits } from "@/web/components/admin/admin-audits";
import { AdminFiles } from "@/web/components/admin/admin-files";
import { AdminJobs } from "@/web/components/admin/admin-jobs";
import { AdminNotifications } from "@/web/components/admin/admin-notifications";
import { AdminParameters } from "@/web/components/admin/admin-parameters";
import { Layout } from "./Layout.tsx";
import Dialogs from "./pages/demo/Dialogs.tsx";
import Toasts from "./pages/demo/Toasts.tsx";
import Audits from "./pages/playgrounds/Audits.tsx";
import Jobs from "./pages/playgrounds/Jobs.tsx";
import Notifications from "./pages/playgrounds/Notifications.tsx";

export class AppRouter {
  // biome-ignore lint/suspicious/noExplicitAny: circular self-reference via `parent: this.layout`
  layout: any = $page({
    component: Layout,
    // biome-ignore lint/suspicious/noExplicitAny: see above
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

  // biome-ignore lint/suspicious/noExplicitAny: self-reference
  home: any = $page({
    parent: this.layout,
    path: "/",
    loader: async () => {
      throw new Redirection("/resources/jobs");
    },
    component: () => null,
  });

  // biome-ignore lint/suspicious/noExplicitAny: self-reference
  playgroundJobs: any = $page({
    parent: this.layout,
    path: "/playgrounds/jobs",
    head: { title: "Jobs playground" },
    component: Jobs,
  });

  // biome-ignore lint/suspicious/noExplicitAny: self-reference
  playgroundNotifications: any = $page({
    parent: this.layout,
    path: "/playgrounds/notifications",
    head: { title: "Notifications playground" },
    component: Notifications,
  });

  // biome-ignore lint/suspicious/noExplicitAny: self-reference
  playgroundAudits: any = $page({
    parent: this.layout,
    path: "/playgrounds/audits",
    head: { title: "Audits playground" },
    component: Audits,
  });

  // biome-ignore lint/suspicious/noExplicitAny: self-reference
  adminJobs: any = $page({
    parent: this.layout,
    path: "/resources/jobs",
    head: { title: "Jobs" },
    component: AdminJobs,
  });

  // biome-ignore lint/suspicious/noExplicitAny: self-reference
  adminAudits: any = $page({
    parent: this.layout,
    path: "/resources/audits",
    head: { title: "Audit log" },
    component: AdminAudits,
  });

  // biome-ignore lint/suspicious/noExplicitAny: self-reference
  adminNotifications: any = $page({
    parent: this.layout,
    path: "/resources/notifications",
    head: { title: "Notifications" },
    component: AdminNotifications,
  });

  // biome-ignore lint/suspicious/noExplicitAny: self-reference
  adminFiles: any = $page({
    parent: this.layout,
    path: "/resources/files",
    head: { title: "Files" },
    component: AdminFiles,
  });

  // biome-ignore lint/suspicious/noExplicitAny: self-reference
  adminParameters: any = $page({
    parent: this.layout,
    path: "/resources/parameters",
    head: { title: "Parameters" },
    component: AdminParameters,
  });

  // biome-ignore lint/suspicious/noExplicitAny: self-reference
  demoToasts: any = $page({
    parent: this.layout,
    path: "/demo/toasts",
    head: { title: "Toasts demo" },
    component: Toasts,
  });

  // biome-ignore lint/suspicious/noExplicitAny: self-reference
  demoDialogs: any = $page({
    parent: this.layout,
    path: "/demo/dialogs",
    head: { title: "Dialogs demo" },
    component: Dialogs,
  });
}
