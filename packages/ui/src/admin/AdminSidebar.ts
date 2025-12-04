import type { ReactRouter } from "@alepha/react";
import type { SidebarNode } from "@alepha/ui";
import { createElement } from "react";
import ToggleSidebarButton from "../core/components/buttons/ToggleSidebarButton.tsx";

export class AdminSidebar {
  public menu = (router: ReactRouter<any>): SidebarNode[] => [
    {
      element: createElement(ToggleSidebarButton),
    },
    {
      type: "spacer",
    },
    {
      ...router.node("adminUsers"),
      description: undefined,
    },
    {
      ...router.node("adminSessions"),
      description: undefined,
    },
    {
      ...router.node("adminNotifications"),
      description: undefined,
    },
    {
      ...router.node("adminFiles"),
      description: undefined,
    },
  ];
}
