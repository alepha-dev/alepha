import { NestedView, useEvents, useStore } from "@alepha/react";
import type {
  AppShellHeaderProps,
  AppShellMainProps,
  AppShellNavbarProps,
} from "@mantine/core";
import { AppShell, type AppShellProps } from "@mantine/core";
import type { ReactNode } from "react";
import { ui } from "../../constants/ui.ts";
import AppBar, { type AppBarProps } from "./AppBar.tsx";
import { Sidebar, type SidebarNode, type SidebarProps } from "./Sidebar.tsx";

export interface AdminShellProps {
  menu?: SidebarNode[];
  appShellProps?: Partial<AppShellProps>;
  appShellMainProps?: Partial<AppShellMainProps>;
  appShellHeaderProps?: Partial<AppShellHeaderProps>;
  appShellNavbarProps?: Partial<AppShellNavbarProps>;
  sidebarProps?: Partial<SidebarProps>;
  headerProps?: Partial<AppBarProps>;
  children?: ReactNode;
}

declare module "@alepha/core" {
  interface State {
    "alepha.ui.sidebar.opened"?: boolean;
  }
}

const AdminShell = (props: AdminShellProps) => {
  const [opened, setOpened] = useStore("alepha.ui.sidebar.opened");

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
        width: 300,
        breakpoint: "sm",
        collapsed: { mobile: !opened },
      }}
      {...props.appShellProps}
    >
      <AppShell.Header bg={ui.colors.surface} {...props.appShellHeaderProps}>
        <AppBar {...props.headerProps} />
      </AppShell.Header>

      <AppShell.Navbar bg={ui.colors.surface} {...props.appShellNavbarProps}>
        <Sidebar {...props.sidebarProps} />
      </AppShell.Navbar>

      <AppShell.Main {...props.appShellMainProps}>
        {props.children ?? <NestedView />}
      </AppShell.Main>
    </AppShell>
  );
};

export default AdminShell;
