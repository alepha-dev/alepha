import {
  AppShell,
  type AppShellFooterProps,
  type AppShellHeaderProps,
  type AppShellMainProps,
  type AppShellNavbarProps,
  type AppShellProps,
} from "@mantine/core";
import { useEvents, useStore } from "alepha/react";
import { NestedView, useRouter } from "alepha/react/router";
import { type ReactNode, useState } from "react";
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

  noSidebarWhen?: {
    /**
     * Paths where the sidebar should be hidden.
     */
    paths?: string[];
  };
}

declare module "alepha" {
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
  const router = useRouter();
  const [opened, setOpened] = useStore("alepha.ui.sidebar.opened");
  const [collapsed] = useStore(
    "alepha.ui.sidebar.collapsed",
    props.sidebarProps?.collapsed,
  );

  const shouldShowSidebar = () => {
    if (props.noSidebarWhen?.paths) {
      for (const path of props.noSidebarWhen.paths) {
        if (
          router.isActive(path, {
            startWith: true,
          })
        ) {
          return false;
        }
      }
    }
    return true;
  };

  const [showSidebar, setShowSidebar] = useState(shouldShowSidebar());

  useEvents(
    {
      "react:transition:end": () => {
        setShowSidebar(shouldShowSidebar());
      },
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

  const hasSidebar = showSidebar && props.sidebarProps !== undefined;
  const hasAppBar = hasSidebar || props.appBarProps || props.header;

  const headerHeight = hasAppBar ? 60 : 0;
  const footerHeight = props.footer ? 24 : 0;
  const sidebarWidth = hasSidebar ? (collapsed ? 78 : 300) : 0;

  return (
    <AppShell
      w={"100%"}
      flex={1}
      padding="md"
      header={hasAppBar ? { height: 60 } : undefined}
      navbar={
        hasSidebar
          ? {
              width: collapsed ? { base: 78 } : { base: 300 },
              breakpoint: "sm",
              collapsed: { mobile: !opened },
            }
          : undefined
      }
      footer={props.footer ? { height: 24 } : undefined}
      {...props.appShellProps}
    >
      <AppShell.Header bg={ui.colors.surface} {...props.appShellHeaderProps}>
        {props.header ?? (
          <AppBar items={defaultAppBarItems} {...props.appBarProps} />
        )}
      </AppShell.Header>

      {hasSidebar && (
        <AppShell.Navbar bg={ui.colors.surface} {...props.appShellNavbarProps}>
          <Sidebar collapsed={collapsed} {...(props.sidebarProps ?? {})} />
        </AppShell.Navbar>
      )}

      <AppShell.Main
        pl={sidebarWidth}
        pt={headerHeight}
        pb={footerHeight}
        pr={0}
        display={"flex"}
        flex={1}
        style={{ flexDirection: "column" }}
        {...props.appShellMainProps}
      >
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
