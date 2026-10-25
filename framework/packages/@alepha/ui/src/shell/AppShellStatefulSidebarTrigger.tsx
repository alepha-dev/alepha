import * as React from "react";

void React;

import { useI18n } from "alepha/react/i18n";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { Button } from "../core/Button.tsx";
import { useSidebar } from "../core/Sidebar.tsx";

export const AppShellStatefulSidebarTrigger = () => {
  const { toggleSidebar, isMobile, openMobile, state } = useSidebar();
  const { tr } = useI18n();
  const open = isMobile ? openMobile : state === "expanded";
  const Icon = open ? PanelLeftClose : PanelLeftOpen;
  return (
    <Button
      variant="minimal"
      size="icon"
      onClick={toggleSidebar}
      aria-label={
        open
          ? tr("nav.sidebar.collapse", { default: "Collapse sidebar" })
          : tr("nav.sidebar.expand", { default: "Expand sidebar" })
      }
      className="size-8"
    >
      {/* The panel glyph points at the sidebar's edge: mirrored when the
          page reads right to left. */}
      <Icon className="size-4 rtl:-scale-x-100" />
    </Button>
  );
};
