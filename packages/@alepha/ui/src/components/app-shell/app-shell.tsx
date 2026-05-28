import * as React from "react";

void React;

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@alepha/ui/components/ui/breadcrumb";
import { Button } from "@alepha/ui/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@alepha/ui/components/ui/hover-card";
import { Separator } from "@alepha/ui/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  useSidebar,
} from "@alepha/ui/components/ui/sidebar";
import { Toaster } from "@alepha/ui/components/ui/sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { useEvents } from "alepha/react";
import { Link, NestedView } from "alepha/react/router";
import { useSidebarState } from "alepha/react/ui";
import {
  ChevronRight,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { Fragment, useRef, useState } from "react";

export interface NavigationProgressOptions {
  /**
   * Tailwind classes applied to the bar. Defaults to `bg-primary`.
   */
  className?: string;
  /**
   * Bar height in pixels. Defaults to 2.
   */
  height?: number;
}

function NavigationProgress(options: NavigationProgressOptions) {
  const [progress, setProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEvents(
    {
      "react:transition:begin": () => {
        setProgress(0);
        setVisible(true);
        setIsLoading(true);
        let current = 0;
        intervalRef.current = setInterval(() => {
          current += (90 - current) * 0.1;
          setProgress(Math.min(90, current));
        }, 100);
      },
      "react:transition:end": () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        setProgress(100);
        setIsLoading(false);
        setTimeout(() => {
          setVisible(false);
          setProgress(0);
        }, 200);
      },
    },
    [],
  );

  if (!visible) return null;
  const height = options.height ?? 2;
  const barClassName = options.className ?? "bg-primary";
  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 pointer-events-none"
      style={{ height }}
    >
      <div
        className={`h-full ${barClassName}`}
        style={{
          width: `${progress}%`,
          transition: isLoading
            ? "width 0.1s ease-out"
            : "width 0.2s ease-out, opacity 0.2s ease-out",
          opacity: isLoading ? 1 : 0,
        }}
      />
    </div>
  );
}

function StatefulSidebarTrigger() {
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
}

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

export interface NavItem {
  label: string;
  /**
   * Required for leaf items. Ignored when `children` is provided (the parent becomes a toggle group).
   */
  href?: string;
  icon?: IconType;
  /**
   * When provided, renders as the active marker. Compare against current path.
   */
  active?: boolean;
  /**
   * Nested items. When set, the parent becomes a collapsible group.
   */
  children?: NavItem[];
  /**
   * Initial open state for groups. Defaults to true if any descendant is active.
   */
  defaultOpen?: boolean;
  /**
   * Optional trailing badge (e.g. unread count). Hidden when the sidebar is collapsed to icons.
   */
  badge?: ReactNode;
  /**
   * When true the item is rendered muted, navigation is blocked, and the
   * `tooltip` (if any) explains why. Use for paywalled / unavailable entries.
   */
  disabled?: boolean;
  /**
   * Hover tooltip shown on the row regardless of sidebar state. When the
   * item is `disabled`, this is the explanation surface (HoverCard, with
   * room to breathe). When the item is enabled, it surfaces as a regular
   * Tooltip on the trigger.
   */
  tooltip?: ReactNode;
}

function hasActiveDescendant(item: NavItem): boolean {
  if (item.active) return true;
  return (item.children ?? []).some(hasActiveDescendant);
}

function SidebarNavItem(props: { item: NavItem }) {
  const { item } = props;
  const Icon = item.icon;
  const children = item.children;
  const isGroup = !!children && children.length > 0;
  const [open, setOpen] = useState(
    item.defaultOpen ?? (isGroup ? hasActiveDescendant(item) : false),
  );

  if (!isGroup) {
    // Disabled rows render with a muted, dashed-border treatment plus a
    // Lock affordance on the trailing edge. Clicks are swallowed. When a
    // `tooltip` is provided, the row opens a HoverCard dropdown on hover
    // so the explanation has space to breathe regardless of sidebar
    // state.
    if (item.disabled) {
      // Bypass SidebarMenuButton — it self-wraps in a Tooltip when given
      // a `tooltip` prop, which would swallow the HoverCard pointer
      // events. A plain styled <div> keeps cursor-not-allowed and lets
      // the row act as the HoverCard trigger.
      const row = (
        <div
          aria-disabled="true"
          className="flex h-8 w-full items-center gap-2 rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 px-2 text-sm text-muted-foreground"
          style={{ cursor: "not-allowed" }}
        >
          {Icon && <Icon className="size-4 shrink-0" />}
          <span className="flex-1 truncate text-left">{item.label}</span>
          <Lock className="size-3.5 shrink-0 opacity-70" />
        </div>
      );
      return (
        <SidebarMenuItem>
          {item.tooltip ? (
            <HoverCard>
              <HoverCardTrigger render={row} />
              <HoverCardContent side="right" align="start" className="text-sm">
                {item.tooltip}
              </HoverCardContent>
            </HoverCard>
          ) : (
            row
          )}
        </SidebarMenuItem>
      );
    }

    const link = (
      <SidebarMenuButton
        isActive={item.active}
        tooltip={item.label}
        render={<Link href={item.href ?? "#"} />}
      >
        {Icon && <Icon className="size-4" />}
        <span>{item.label}</span>
      </SidebarMenuButton>
    );

    const row = item.tooltip ? (
      <Tooltip>
        <TooltipTrigger render={link} />
        <TooltipContent side="right">{item.tooltip}</TooltipContent>
      </Tooltip>
    ) : (
      link
    );

    return (
      <SidebarMenuItem>
        {row}
        {item.badge != null && item.badge !== false && (
          <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
        )}
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={() => setOpen((v) => !v)}
        isActive={item.active}
        tooltip={item.label}
      >
        {Icon && <Icon className="size-4" />}
        <span className="flex-1 text-left">{item.label}</span>
        <ChevronRight
          className={`size-4 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </SidebarMenuButton>
      {open && (
        <SidebarMenuSub>
          {children.map((child, ci) => (
            <SidebarMenuSubItem key={child.href ?? ci}>
              {child.children && child.children.length > 0 ? (
                <SidebarNavItem item={child} />
              ) : (
                <SidebarMenuSubButton
                  isActive={child.active}
                  render={<Link href={child.href ?? "#"} />}
                >
                  {child.icon && <child.icon className="size-4" />}
                  <span>{child.label}</span>
                </SidebarMenuSubButton>
              )}
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export interface AppShellProps {
  /**
   * Branding shown at the top of the sidebar.
   */
  brand?: ReactNode;
  /**
   * Sidebar navigation groups.
   */
  nav?: NavGroup[];
  /**
   * Content rendered at the bottom of the sidebar (user menu, etc.).
   */
  sidebarFooter?: ReactNode;
  /**
   * Breadcrumb crumbs (last one is rendered as the current page).
   */
  breadcrumbs?: { label: string; href?: string }[];
  /**
   * Top-bar right-side content (search, theme toggle, user menu).
   */
  topbarActions?: ReactNode;
  /**
   * Layout variant.
   * - `sidebar` (default): sidebar and page sit flush side-by-side.
   * - `inset`: sidebar uses the global background; the page is a rounded card with margin.
   * - `floating`: the page uses the global background; the sidebar is a rounded card with margin.
   */
  variant?: "sidebar" | "floating" | "inset";
  /**
   * When `variant="inset"`, lift the header out of the floating card so it
   * sits on the sidebar background — only the main page becomes the card.
   * Has no effect on other variants.
   */
  headerOutside?: boolean;
  /**
   * Top loading bar shown during route transitions.
   * `true` (default) enables it with default styling, `false` disables it,
   * or pass an options object to customize.
   */
  progress?: boolean | NavigationProgressOptions;
  /**
   * Page content. Defaults to `<NestedView />` (renders the active route).
   */
  children?: ReactNode;
  /**
   * When `true`, the shell assumes it is mounted inside an outer provider tree
   * and skips its own `<DialogProvider>` and `<Toaster />` wrappers. Use this
   * when a parent layout already provides them.
   */
  embedded?: boolean;
  /**
   * When `true`, the shell fills its parent container instead of the viewport
   * (`min-h-svh`). Use when a parent layout owns the height (e.g. when a
   * sticky footer sits below the shell).
   */
  fill?: boolean;
}

/**
 * Standard SaaS layout: collapsible sidebar + topbar with breadcrumbs.
 * Built on shadcn `<Sidebar>` + `<Breadcrumb>`.
 */
export function AppShell(props: AppShellProps) {
  const { collapsed, setCollapsed } = useSidebarState();
  const nav = props.nav ?? [];
  const variant = props.variant ?? "sidebar";
  const progress = props.progress ?? true;
  const headerOutside = !!props.headerOutside && variant === "inset";

  const headerNode = (
    <header
      className={
        headerOutside
          ? "bg-sidebar flex h-14 shrink-0 items-center gap-2 px-4"
          : "bg-background flex h-14 shrink-0 items-center gap-2 border-b px-4"
      }
    >
      <StatefulSidebarTrigger />
      <Separator orientation="vertical" className="mx-2 h-4" />
      {props.breadcrumbs && props.breadcrumbs.length > 0 && (
        <Breadcrumb>
          <BreadcrumbList>
            {props.breadcrumbs.map((crumb, i) => {
              const last = i === props.breadcrumbs!.length - 1;
              return (
                <Fragment key={i}>
                  <BreadcrumbItem>
                    {last || !crumb.href ? (
                      <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink render={<Link href={crumb.href} />}>
                        {crumb.label}
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                  {!last && <BreadcrumbSeparator />}
                </Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      )}
      <div className="flex-1" />
      {props.topbarActions}
    </header>
  );

  const mainNode = (
    // Layout contract for `fill: true` pages:
    //   parent (`h-svh`) → SidebarProvider (`h-full`) → SidebarInset → main
    //   - main is `flex flex-col min-h-0 flex-1` so its children can
    //     claim the leftover height via `flex-1 min-h-0`.
    //   - main itself is `overflow-hidden` (not `overflow-auto`) so the
    //     table's inner `overflow-auto` is the actual scroll surface —
    //     header stays sticky, body scrolls, no page-level scrollbar.
    //   - For non-fill pages there's no height bound, so this collapses
    //     to "scroll whatever overflows" without further config.
    <main
      className={
        props.fill
          ? "flex min-h-0 flex-1 flex-col overflow-hidden"
          : "flex-1 overflow-auto"
      }
    >
      {props.children ?? <NestedView />}
    </main>
  );
  const renderBody = () => (
    <>
      {progress !== false && (
        <NavigationProgress {...(progress === true ? {} : progress)} />
      )}
      <SidebarProvider
        open={!collapsed}
        onOpenChange={(o: boolean) => setCollapsed(!o)}
        className={props.fill ? "min-h-0 h-full" : undefined}
      >
        <Sidebar collapsible="icon" variant={variant}>
          <SidebarHeader>{props.brand}</SidebarHeader>
          <SidebarContent>
            {nav.map((group, gi) => (
              <SidebarGroup key={gi}>
                {group.label && (
                  <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                )}
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item, ii) => (
                      <SidebarNavItem
                        key={item.href ?? `${gi}-${ii}`}
                        item={item}
                      />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>
          {props.sidebarFooter && (
            <SidebarFooter>{props.sidebarFooter}</SidebarFooter>
          )}
        </Sidebar>
        {headerOutside ? (
          <div className="bg-sidebar flex flex-1 flex-col">
            {headerNode}
            <div className="bg-background m-2 mt-0 flex flex-1 flex-col overflow-hidden rounded-xl border shadow-sm">
              {mainNode}
            </div>
          </div>
        ) : (
          <SidebarInset
            className={
              variant === "inset"
                ? "md:peer-data-[variant=inset]:overflow-hidden"
                : undefined
            }
          >
            {headerNode}
            {mainNode}
          </SidebarInset>
        )}
      </SidebarProvider>
    </>
  );

  if (props.embedded) {
    return renderBody();
  }

  return (
    <DialogProvider>
      {renderBody()}
      <Toaster />
    </DialogProvider>
  );
}
