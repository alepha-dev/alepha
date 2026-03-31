import { IconBell } from "@tabler/icons-react";
import type { AdminNotificationController } from "alepha/api/notifications";
import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";

export class AdminNotificationRouter {
  protected readonly notificationCtrl = $client<AdminNotificationController>();

  adminNotifications = $page({
    icon: IconBell,
    path: "/notifications",
    label: "Notifications",
    description: "View sent notifications and their delivery status.",
    head: { title: "Notifications" },
    can: () => this.notificationCtrl.findNotifications.can(),
    lazy: () => import("./components/AdminNotifications.tsx"),
  });
}
