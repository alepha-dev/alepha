import { NestedView, useEvents, useStore } from "@alepha/react";
import {
  AppShell,
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
  sidebarProps?: Partial<SidebarProps>;
  appBarProps?: Partial<AppBarProps>;
  children?: ReactNode;
}

declare module "@alepha/core" {
  interface State {
    "alepha.ui.sidebar.opened"?: boolean;
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

  return (
    <AppShell
      padding="md"
      header={{ height: 60 }}
      navbar={{
        width: collapsed ? { base: 72 } : { base: 300 },
        breakpoint: "sm",
        collapsed: { mobile: !opened },
      }}
      {...props.appShellProps}
    >
      <AppShell.Header bg={ui.colors.surface} {...props.appShellHeaderProps}>
        <AppBar {...props.appBarProps} />
      </AppShell.Header>

      <AppShell.Navbar bg={ui.colors.surface} {...props.appShellNavbarProps}>
        <Sidebar collapsed={collapsed} {...props.sidebarProps} />
      </AppShell.Navbar>

      <AppShell.Main {...props.appShellMainProps}>
        {props.children ?? <NestedView />}
      </AppShell.Main>
    </AppShell>
  );
};

export default AdminShell;
