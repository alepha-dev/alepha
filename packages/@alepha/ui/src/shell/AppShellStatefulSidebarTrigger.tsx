import * as React from "react";

void React;

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { Button } from "../core/Button.tsx";
import { useSidebar } from "../core/Sidebar.tsx";

export const AppShellStatefulSidebarTrigger = () => {
  const { toggleSidebar, isMobile, openMobile, state } = useSidebar();
  const open = isMobile ? openMobile : state === "expanded";
  const Icon = open ? PanelLeftClose : PanelLeftOpen;
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleSidebar}
      aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
      className="size-8"
    >
      <Icon className="size-4" />
    </Button>
  );
};
