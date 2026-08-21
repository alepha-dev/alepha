import { cn } from "@alepha/ui/lib/utils";
import * as React from "react";

void React;

import {
  ActionErrorToaster,
  type ActionErrorToasterProps,
} from "@alepha/ui/components/action-error-toaster/action-error-toaster";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
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
  TooltipProvider,
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
      className="pointer-events-none fixed top-0 right-0 left-0 z-50"
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
  label: ReactNode;
  /**
   * Required for leaf items. Ignored when `children` is provided (the parent becomes a toggle group).
   */
  href?: string;
  /**
   * Either an icon *component* (e.g. a lucide `Users`) which is instantiated
   * with the row's sizing className, or an already-rendered ReactNode element
   * (e.g. `<Users />`). The latter lets nav metadata declared on a `$page`
   * (which is pure React) carry its icon as a node — see `useNavTree`.
   */
  icon?: IconType | ReactNode;
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

/**
 * Render a NavItem icon. An already-created element (e.g. `<Users />`, which
 * `React.isValidElement` recognises) is returned as-is; anything else is
 * treated as a component *type* — including lucide's `forwardRef` icons, which
 * are objects rather than plain functions — and instantiated with the row's
 * sizing className.
 */
function renderNavIcon(icon: NavItem["icon"], className: string): ReactNode {
  if (icon == null || icon === false) return null;
  if (React.isValidElement(icon)) {
    // Already an element (e.g. `<Users />`): clone it to apply the row's sizing
    // className so element icons render at the same size as component icons,
    // merging with any className the caller already set.
    const existing = (icon.props as { className?: string })?.className;
    return React.cloneElement(
      icon as React.ReactElement<{ className?: string }>,
      {
        className: existing ? `${existing} ${className}` : className,
      },
    );
  }
  const Icon = icon as IconType;
  return <Icon className={className} />;
}

function SidebarNavItem(props: { item: NavItem }) {
  const { item } = props;
  const { state, isMobile } = useSidebar();
  const children = item.children;
  const isGroup = !!children && children.length > 0;
  const hasActive = isGroup && hasActiveDescendant(item);
  const [open, setOpen] = useState(item.defaultOpen ?? hasActive);
  // Reveal a collapsed group when navigation makes one of its descendants
  // active — SPA nav, spotlight (⌘K), breadcrumb, or a deep-link that doesn't
  // remount this item (useState's initializer runs only at mount, so without
  // this the group stays stuck closed and the active page is hidden — petition
  // #4). Only OPENS; never auto-collapses, so a manual toggle is preserved.
  const [wasActive, setWasActive] = useState(hasActive);
  if (hasActive !== wasActive) {
    setWasActive(hasActive);
    if (hasActive) setOpen(true);
  }

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
          className="border-muted-foreground/40 bg-muted/40 text-muted-foreground flex h-8 w-full items-center gap-2 rounded-md border border-dashed px-2 text-sm"
          style={{ cursor: "not-allowed" }}
        >
          {renderNavIcon(item.icon, "size-4 shrink-0")}
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
        tooltip={typeof item.label === "string" ? item.label : undefined}
        render={<Link href={item.href ?? "#"} />}
      >
        {renderNavIcon(item.icon, "size-4")}
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

  // Collapsed to icons, the expanded branch below is a dead button: it still
  // flips `open`, but what `open` reveals is a `SidebarMenuSub`, which carries
  // `group-data-[collapsible=icon]:hidden`. The group has no `href` either, so
  // there is no fallback — every child is simply unreachable. A dropdown is the
  // standard answer, and it belongs here rather than in any one app because
  // this hits EVERY `NavItem` with children.
  //
  // Mobile is excluded: it uses the sheet, not icon mode, so the sub renders
  // normally there.
  if (isGroup && state === "collapsed" && !isMobile) {
    return (
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              // No `tooltip` here on purpose. `SidebarMenuButton` turns itself
              // into a `TooltipTrigger` when given one, and layering the
              // dropdown trigger on top makes hover and click fight over the
              // same element. The menu names itself with a label instead.
              //
              // `hasActive` joins `item.active` so the trigger still reads as
              // current when a descendant is — collapsed, it is the only clue
              // which group holds the open page.
              <SidebarMenuButton isActive={item.active || hasActive} />
            }
          >
            {renderNavIcon(item.icon, "size-4")}
            <span className="flex-1 text-left">{item.label}</span>
            <ChevronRight className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="min-w-48">
            {/*
              The group wrapper is required, not cosmetic: `DropdownMenuLabel`
              is Base UI's `Menu.GroupLabel`, which reads `MenuGroupContext` and
              THROWS outside a `Menu.Group`. Nothing types this — the label
              compiles fine, and the whole app-shell crashes at the first click
              on the trigger, because the throw happens when the menu opens
              rather than when it mounts.
            */}
            <DropdownMenuGroup>
              <DropdownMenuLabel>{item.label}</DropdownMenuLabel>
              <NavDropdownItems items={children} />
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={() => setOpen((v) => !v)}
        isActive={item.active}
        tooltip={typeof item.label === "string" ? item.label : undefined}
      >
        {renderNavIcon(item.icon, "size-4")}
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
                  {renderNavIcon(child.icon, "size-4")}
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

/**
 * The children of a collapsed nav group, as dropdown entries.
 *
 * Recurses through nested groups via `DropdownMenuSub` — `SidebarNavItem`
 * recurses into itself for depth-2 groups in the expanded tree, and without the
 * matching recursion here a nested group would be dead again one level down,
 * which is the very bug this branch exists to fix.
 *
 * Badges are carried inline. `SidebarMenuBadge` is
 * `group-data-[collapsible=icon]:hidden`, so a collapsed sidebar drops every
 * count — and the count is usually why you opened the group.
 */
function NavDropdownItems(props: { items: NavItem[] }) {
  return (
    <>
      {props.items.map((child, ci) => {
        const badge = child.badge != null && child.badge !== false && (
          <span className="text-muted-foreground ml-auto pl-2 text-xs tabular-nums">
            {child.badge}
          </span>
        );

        if (child.children && child.children.length > 0) {
          return (
            <DropdownMenuSub key={child.href ?? ci}>
              <DropdownMenuSubTrigger>
                {renderNavIcon(child.icon, "size-4")}
                <span>{child.label}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <NavDropdownItems items={child.children} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        }

        if (child.disabled) {
          return (
            <DropdownMenuItem key={child.href ?? ci} disabled>
              {renderNavIcon(child.icon, "size-4")}
              <span>{child.label}</span>
              <Lock className="ml-auto size-3.5 opacity-70" />
            </DropdownMenuItem>
          );
        }

        return (
          <DropdownMenuItem
            key={child.href ?? ci}
            render={<Link href={child.href ?? "#"} />}
          >
            {renderNavIcon(child.icon, "size-4")}
            <span>{child.label}</span>
            {badge}
          </DropdownMenuItem>
        );
      })}
    </>
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
  breadcrumbs?: { label: ReactNode; href?: string }[];
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
   * Surface failed `useAction` / `useQuery` calls as a toast (via the
   * `react:action:error` event). `true` (default) enables it, `false`
   * disables it, or pass an options object to configure
   * (see {@link ActionErrorToasterProps}). Ignored when `embedded` (the
   * parent layout owns the toaster).
   */
  actionErrorToaster?: boolean | ActionErrorToasterProps;
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
  /**
   * Extra classes for the scrolling `<main>` element.
   *
   * Exists so an app can paint its own page surface (Lore stamps a dot
   * texture there) without every other consumer of the shell inheriting it.
   * Layout classes are applied after this, so a caller cannot break the
   * flex/overflow contract described above.
   */
  mainClassName?: string;
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
      <Separator orientation="vertical" className="mx-2" />
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
      className={cn(
        props.mainClassName,
        props.fill
          ? "flex min-h-0 flex-1 flex-col overflow-hidden"
          : "flex-1 overflow-auto",
      )}
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
        // `fill` = a parent owns the height (e.g. a full-width banner above
        // the shell). The desktop sidebar is `fixed inset-y-0 h-svh` (pinned
        // to the VIEWPORT), so it would overlap whatever sits above the
        // shell — re-anchor it to this wrapper instead (absolute within the
        // now-relative provider, height from the wrapper). The arbitrary
        // selectors out-specify the base `.fixed`/`.h-svh` utilities.
        className={
          props.fill
            ? "relative h-full min-h-0 [&_[data-slot=sidebar-container]]:absolute [&_[data-slot=sidebar-container]]:h-auto"
            : undefined
        }
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
                ? "border md:peer-data-[variant=inset]:overflow-hidden"
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

  const errorToaster = props.actionErrorToaster ?? true;

  return (
    <DialogProvider>
      <TooltipProvider>
        {renderBody()}
        <Toaster />
        {errorToaster !== false && (
          <ActionErrorToaster
            {...(typeof errorToaster === "object" ? errorToaster : {})}
          />
        )}
      </TooltipProvider>
    </DialogProvider>
  );
}
