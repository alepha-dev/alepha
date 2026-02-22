import { alephaSidebarAtom, Flex } from "@alepha/ui";
import {
  AppShell,
  type AppShellFooterProps,
  type AppShellHeaderProps,
  type AppShellMainProps,
  type AppShellNavbarProps,
  type AppShellProps,
  type ContainerProps,
} from "@mantine/core";
import { useEvents, useStore } from "alepha/react";
import { NestedView, useRouter } from "alepha/react/router";
import type { ReactNode } from "react";
import { useState } from "react";
import AppBar, { type AppBarProps } from "./AppBar.tsx";
import { Sidebar, type SidebarProps } from "./Sidebar.tsx";

export interface DashboardShellProps {
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

  /**
   * AppShell layout mode.
   * - "default": header/footer span full width, navbar below header.
   * - "alt": navbar is full height, header/footer offset by navbar width.
   */
  layout?: "default" | "alt";

  /**
   * Content rendered above the Sidebar inside the navbar (e.g. logo).
   */
  navbarHeader?: ReactNode;

  /**
   * Content rendered below the Sidebar inside the navbar (e.g. toggle button).
   */
  navbarFooter?: ReactNode;

  /**
   * Height of the header bar in pixels.
   * @default 60
   */
  headerHeight?: number;

  /**
   * Height of the footer bar in pixels.
   * @default 24
   */
  footerHeight?: number;

  noSidebarWhen?: {
    /**
     * Paths where the sidebar should be hidden.
     */
    paths?: string[];
  };

  /**
   * Wrap AppBar and main content in a Mantine Container.
   * Pass `true` for default Container, or ContainerProps to customize.
   */
  container?: boolean | ContainerProps;
}

const DashboardShell = (props: DashboardShellProps) => {
  const router = useRouter();
  const [sidebar, setSidebar] = useStore(alephaSidebarAtom);
  const collapsed =
    props.sidebarProps?.collapsed !== undefined
      ? props.sidebarProps.collapsed
      : sidebar.collapsed;

  const { collapsedWidth, expandedWidth } = sidebar;

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
        setSidebar({ ...sidebar, closed: true });
      },
    },
    [sidebar],
  );

  // Default AppBar items with burger button on the left
  const defaultAppBarItems = [
    { position: "left" as const, type: "burger" as const },
  ];

  // Forward container to appBarProps if not already set
  const appBarProps = { ...props.appBarProps };
  appBarProps.container ??= props.container;

  const hasSidebar = showSidebar && props.sidebarProps !== undefined;
  const hasAppBar = props.appBarProps || props.header;

  let footerElement = props.footer;
  if (props.footerHeight) {
    footerElement ??= <Flex h={props.footerHeight} />;
  }

  const hHeight = props.headerHeight ?? 60;
  const fHeight = props.footerHeight ?? 24;
  const headerHeight = hasAppBar ? hHeight : 0;
  const footerHeight = footerElement ? fHeight : 0;
  const navbarWidth = collapsed ? collapsedWidth : expandedWidth;

  return (
    <AppShell
      layout={"alt"}
      w={"100%"}
      flex={1}
      header={hasAppBar ? { height: hHeight } : undefined}
      navbar={
        hasSidebar
          ? {
              width: { base: navbarWidth },
              breakpoint: "md",
              collapsed: { mobile: sidebar.closed },
            }
          : undefined
      }
      footer={footerElement ? { height: fHeight } : undefined}
      {...props.appShellProps}
    >
      {hasAppBar && (
        <AppShell.Header {...props.appShellHeaderProps}>
          {props.header ?? (
            <AppBar items={defaultAppBarItems} {...appBarProps} />
          )}
        </AppShell.Header>
      )}

      {hasSidebar && (
        <AppShell.Navbar
          className="alepha-sidebar-navbar"
          {...props.appShellNavbarProps}
        >
          {props.navbarHeader ? (
            <Flex
              style={{
                borderBottom: "1px solid var(--mantine-color-default-border)",
              }}
              h={headerHeight}
            >
              {props.navbarHeader}
            </Flex>
          ) : null}
          <Sidebar {...(props.sidebarProps ?? {})} collapsed={collapsed} />
          {props.navbarFooter ? (
            <Flex
              style={{
                borderTop: "1px solid var(--mantine-color-default-border)",
              }}
              h={footerHeight}
            >
              {props.navbarFooter}
            </Flex>
          ) : null}
        </AppShell.Navbar>
      )}

      <AppShell.Main pos={"relative"} {...props.appShellMainProps}>
        {props.children ?? <NestedView />}
      </AppShell.Main>

      {footerElement && (
        <AppShell.Footer {...props.appShellFooterProps}>
          {footerElement}
        </AppShell.Footer>
      )}
    </AppShell>
  );
};

export default DashboardShell;
