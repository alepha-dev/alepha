import {
  AppShell,
  type AppShellFooterProps,
  type AppShellHeaderProps,
  type AppShellMainProps,
  type AppShellNavbarProps,
  type AppShellProps,
  Container,
  type ContainerProps,
  Flex,
} from "@mantine/core";
import { useEvents, useStore } from "alepha/react";
import { NestedView, useRouter } from "alepha/react/router";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { alephaSidebarAtom } from "../../atoms/alephaSidebarAtom.ts";
import AppBar, { type AppBarProps } from "./AppBar.tsx";
import {
  Sidebar,
  type SidebarMenuItem,
  type SidebarProps,
} from "./Sidebar.tsx";

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

  /**
   * Enable drag-to-resize for the sidebar.
   * Width and constraints are configured in alephaSidebarAtom.
   */
  sidebarResizable?: boolean;

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
  const { opened, collapsed } = sidebar;

  // Initialize collapsed state from props on mount
  useEffect(() => {
    if (props.sidebarProps?.collapsed !== undefined) {
      setSidebar({ ...sidebar, collapsed: props.sidebarProps.collapsed });
    }
  }, []);

  // Resize state
  const [isResizing, setIsResizing] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [collapseEffect, setCollapseEffect] = useState({
    offset: 0,
    opacity: 1,
  });
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Use atom values for constraints
  const {
    collapsedWidth,
    collapseThreshold,
    maxWidth,
    hoverDelay,
    defaultWidth,
  } = sidebar;

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (!props.sidebarResizable) return;
      e.preventDefault();

      // If collapsed and hovering, un-collapse first and start from defaultWidth
      if (collapsed) {
        setSidebar({ ...sidebar, collapsed: false, width: defaultWidth });
        setIsResizing(true);
        resizeRef.current = {
          startX: e.clientX,
          startWidth: defaultWidth,
        };
      } else {
        setIsResizing(true);
        resizeRef.current = {
          startX: e.clientX,
          startWidth: sidebar.width,
        };
      }
    },
    [props.sidebarResizable, collapsed, sidebar, setSidebar, defaultWidth],
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = e.clientX - resizeRef.current.startX;
      const rawWidth = resizeRef.current.startWidth + delta;
      const newWidth = Math.min(Math.max(rawWidth, collapsedWidth), maxWidth);

      // Visual effect when below collapse threshold
      if (rawWidth < collapseThreshold) {
        const progress = Math.max(
          0,
          (collapseThreshold - rawWidth) / collapseThreshold,
        );
        setCollapseEffect({
          offset: -progress * collapsedWidth,
          opacity: 1 - progress * 0.7,
        });
        setSidebar({ ...sidebar, width: collapseThreshold, collapsed: false });
      } else {
        setCollapseEffect({ offset: 0, opacity: 1 });
        setSidebar({ ...sidebar, width: newWidth, collapsed: false });
      }
    };

    const handleMouseUp = () => {
      // If we released while in collapse zone, actually collapse
      if (collapseEffect.offset < 0) {
        setSidebar({ ...sidebar, collapsed: true });
      }
      setCollapseEffect({ offset: 0, opacity: 1 });
      setIsResizing(false);
      resizeRef.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    isResizing,
    sidebar,
    setSidebar,
    collapsedWidth,
    maxWidth,
    collapseThreshold,
    collapseEffect.offset,
  ]);

  // Hover to expand when collapsed (with delay)
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleNavbarMouseEnter = useCallback(() => {
    if (collapsed) {
      hoverTimeoutRef.current = setTimeout(() => {
        setIsHovering(true);
      }, hoverDelay);
    }
  }, [collapsed, hoverDelay]);

  const handleNavbarMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsHovering(false);
  }, []);

  // Reset hover state when collapsed changes (e.g., when toggle button is clicked)
  useEffect(() => {
    if (collapsed) {
      setIsHovering(false);
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
    }
  }, [collapsed]);

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
        setSidebar({ ...sidebar, opened: false });
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

  const hHeight = props.headerHeight ?? 60;
  const fHeight = props.footerHeight ?? 24;
  const headerHeight = hasAppBar ? hHeight : 0;
  const footerHeight = props.footer ? fHeight : 0;
  const expandedWidth = Math.max(sidebar.width, collapsedWidth);

  // When collapsed but hovering, show defaultWidth (not current width)
  const isExpandedByHover = collapsed && isHovering;
  const effectiveCollapsed = collapsed && !isHovering;

  // Wrap onItemClick to collapse sidebar when clicking during hover-expansion
  const handleSidebarItemClick = useCallback(
    (item: SidebarMenuItem) => {
      if (isExpandedByHover) {
        setIsHovering(false);
      }
      props.sidebarProps?.onItemClick?.(item);
    },
    [isExpandedByHover, props.sidebarProps?.onItemClick],
  );
  const hoverWidth = Math.max(defaultWidth, collapsedWidth);
  // When hovering, keep main content at collapsed width (sidebar overlays)
  const sidebarWidth = hasSidebar
    ? effectiveCollapsed || isExpandedByHover
      ? collapsedWidth
      : expandedWidth
    : 0;
  const canResize = props.sidebarResizable && !collapsed;

  return (
    <AppShell
      layout={props.layout}
      w={"100%"}
      flex={1}
      header={hasAppBar ? { height: hHeight } : undefined}
      navbar={
        hasSidebar
          ? {
              // When hovering, keep collapsed width to avoid pushing content
              width:
                effectiveCollapsed || isExpandedByHover
                  ? { base: collapsedWidth }
                  : { base: expandedWidth },
              breakpoint: "sm",
              collapsed: { mobile: !opened },
            }
          : undefined
      }
      footer={props.footer ? { height: fHeight } : undefined}
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
          data-resizing={isResizing}
          data-hover-expanded={isExpandedByHover}
          onMouseEnter={handleNavbarMouseEnter}
          onMouseLeave={handleNavbarMouseLeave}
          style={{
            transform: collapseEffect.offset
              ? `translateX(${collapseEffect.offset}px)`
              : undefined,
            opacity: collapseEffect.opacity,
            // When hovering, expand width visually as overlay
            ...(isExpandedByHover && {
              width: hoverWidth,
              zIndex: 200,
              boxShadow: "var(--mantine-shadow-xl)",
            }),
          }}
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
          <Sidebar
            {...(props.sidebarProps ?? {})}
            collapsed={effectiveCollapsed}
            onItemClick={handleSidebarItemClick}
          />
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
          {(canResize || isExpandedByHover) && (
            <Flex
              pos="absolute"
              right={-6}
              top={0}
              bottom={0}
              w={12}
              style={{
                cursor: "col-resize",
                userSelect: "none",
              }}
              onMouseDown={handleResizeStart}
            />
          )}
        </AppShell.Navbar>
      )}

      <AppShell.Main
        className="alepha-sidebar-main"
        data-resizing={isResizing}
        {...props.appShellMainProps}
      >
        {props.container ? (
          <Container
            w={"100%"}
            flex={1}
            display="flex"
            style={{ flexDirection: "column" }}
            {...(typeof props.container === "boolean" ? {} : props.container)}
          >
            {props.children ?? <NestedView />}
          </Container>
        ) : (
          (props.children ?? <NestedView />)
        )}
      </AppShell.Main>

      {props.footer && (
        <AppShell.Footer {...props.appShellFooterProps}>
          {props.footer}
        </AppShell.Footer>
      )}
    </AppShell>
  );
};

export default DashboardShell;
