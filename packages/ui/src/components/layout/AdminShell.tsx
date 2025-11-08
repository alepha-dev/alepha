import { NestedView, useEvents, useStore } from "@alepha/react";
import {
  AppShell,
  type AppShellFooterProps,
  type AppShellHeaderProps,
  type AppShellMainProps,
  type AppShellNavbarProps,
  type AppShellProps,
} from "@mantine/core";
import type { ReactNode } from "react";
import { ui } from "../../constants/ui.ts";
import AppBar, { type AppBarProps } from "./AppBar.tsx";
import { Sidebar, type SidebarProps } from "./Sidebar.tsx";

export interface AdminShellProps {
  appShellProps?: Partial<AppShellProps>;
  appShellMainProps?: Partial<AppShellMainProps>;
  appShellHeaderProps?: Partial<AppShellHeaderProps>;
  appShellNavbarProps?: Partial<AppShellNavbarProps>;
  appShellFooterProps?: Partial<AppShellFooterProps>;
  sidebarProps?: Partial<SidebarProps>;
  appBarProps?: Partial<AppBarProps>;
  header?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}

declare module "@alepha/core" {
  interface State {
    /**
     * Whether the sidebar is opened or closed.
     */
    "alepha.ui.sidebar.opened"?: boolean;

    /**
     * Whether the sidebar is collapsed (narrow) or expanded (wide).
     */
    "alepha.ui.sidebar.collapsed"?: boolean;
  }
}

const AdminShell = (props: AdminShellProps) => {
  const [opened, setOpened] = useStore("alepha.ui.sidebar.opened");
  const [collapsed] = useStore(
    "alepha.ui.sidebar.collapsed",
    props.sidebarProps?.collapsed,
  );

  useEvents(
    {
      "react:transition:begin": () => {
        setOpened(false);
      },
    },
    [],
  );

  // Default AppBar items with burger button on the left
  const defaultAppBarItems = [
    { position: "left" as const, type: "burger" as const },
  ];

  return (
    <AppShell
      padding="md"
      header={{ height: 60 }}
      navbar={
        props.sidebarProps !== undefined
          ? {
              width: collapsed ? { base: 72 } : { base: 300 },
              breakpoint: "sm",
              collapsed: { mobile: !opened },
            }
          : undefined
      }
      footer={props.footer ? { height: 60 } : undefined}
      {...props.appShellProps}
    >
      <AppShell.Header bg={ui.colors.surface} {...props.appShellHeaderProps}>
        {props.header ?? (
          <AppBar items={defaultAppBarItems} {...props.appBarProps} />
        )}
      </AppShell.Header>

      {props.sidebarProps !== undefined && (
        <AppShell.Navbar bg={ui.colors.surface} {...props.appShellNavbarProps}>
          <Sidebar collapsed={collapsed} {...props.sidebarProps} />
        </AppShell.Navbar>
      )}

      <AppShell.Main {...props.appShellMainProps}>
        {props.children ?? <NestedView />}
      </AppShell.Main>

      {props.footer && (
        <AppShell.Footer bg={ui.colors.surface} {...props.appShellFooterProps}>
          {props.footer}
        </AppShell.Footer>
      )}
    </AppShell>
  );
};

export default AdminShell;
