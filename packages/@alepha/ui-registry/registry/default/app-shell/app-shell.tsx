import { useEvents } from "alepha/react";
import { Link, NestedView } from "alepha/react/router";
import { useSidebarState } from "alepha/react/ui";
import { ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { Fragment, useRef, useState } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { DialogProvider } from "@/registry/default/use-dialog/use-dialog";

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
  const { collapsed, toggle } = useSidebarState();
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
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
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={item.active} tooltip={item.label}>
          <Link href={item.href ?? "#"}>
            {Icon && <Icon className="size-4" />}
            <span>{item.label}</span>
          </Link>
        </SidebarMenuButton>
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
                <SidebarMenuSubButton asChild isActive={child.active}>
                  <Link href={child.href ?? "#"}>
                    {child.icon && <child.icon className="size-4" />}
                    <span>{child.label}</span>
                  </Link>
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
                      <BreadcrumbLink asChild>
                        <Link href={crumb.href}>{crumb.label}</Link>
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
    <main className="flex-1 overflow-auto">
      {props.children ?? <NestedView />}
    </main>
  );
  return (
    <DialogProvider>
      {progress !== false && (
        <NavigationProgress {...(progress === true ? {} : progress)} />
      )}
      <SidebarProvider
        open={!collapsed}
        onOpenChange={(o: boolean) => setCollapsed(!o)}
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
          <SidebarInset>
            {headerNode}
            {mainNode}
          </SidebarInset>
        )}
      </SidebarProvider>
      <Toaster />
    </DialogProvider>
  );
}
