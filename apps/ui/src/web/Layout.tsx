import { AppShell } from "@alepha/ui/components/app-shell/app-shell";
import { ButtonDark } from "@alepha/ui/components/button-dark/button-dark";
import { TooltipProvider } from "@alepha/ui/components/ui/tooltip";
import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { NestedView, useRouterState } from "alepha/react/router";
import { ColorScheme } from "alepha/react/ui";
import {
  BookOpen,
  FileSearch,
  Home as HomeIcon,
  LayoutDashboard,
  ListChecks,
  MessageSquareWarning,
  MousePointerClick,
  SlidersHorizontal,
  Table2,
  UsersIcon,
  ChartLine,
  Bell,
  FilesIcon,
  KeyRound,
  MonitorSmartphone,
  Zap,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Home", icon: HomeIcon },
      { href: "/primitives", label: "Primitives", icon: BookOpen },
    ],
  },
  {
    label: "Admin",
    items: [
      {
        href: "/blocks/admin/dashboard",
        label: "Dashboard",
        icon: LayoutDashboard,
      },
      { href: "/blocks/admin/users", label: "Users", icon: UsersIcon },
      { href: "/blocks/admin/jobs", label: "Jobs", icon: Zap },
      {
        href: "/blocks/admin/sessions",
        label: "Sessions",
        icon: MonitorSmartphone,
      },
      { href: "/blocks/admin/keys", label: "API keys", icon: KeyRound },
      { href: "/blocks/admin/files", label: "Files", icon: FilesIcon },
      {
        href: "/blocks/admin/notifications",
        label: "Notifications",
        icon: Bell,
      },
      {
        href: "/blocks/admin/parameters",
        label: "Parameters",
        icon: SlidersHorizontal,
      },
      { href: "/blocks/admin/analytics", label: "Analytics", icon: ChartLine },
      { href: "/blocks/admin/audits", label: "Audit log", icon: FileSearch },
    ],
  },
  {
    label: "Blocks",
    items: [
      { href: "/blocks/table", label: "AlephaTable", icon: Table2 },
      { href: "/blocks/controls", label: "Controls", icon: SlidersHorizontal },
      { href: "/blocks/auto-form", label: "AutoForm", icon: ListChecks },
      {
        href: "/blocks/feedback",
        label: "Toasts & dialogs",
        icon: MessageSquareWarning,
      },
      {
        href: "/blocks/buttons",
        label: "Buttons",
        icon: MousePointerClick,
      },
    ],
  },
];

const findCrumbs = (pathname: string): { label: string; href?: string }[] => {
  for (const group of NAV) {
    const match = group.items.find((it) => it.href === pathname);
    if (match) {
      return [{ label: group.label }, { label: match.label }];
    }
  }
  return [];
};

/**
 * The shell, and itself a specimen: `AppShell` in `floating` variant is what
 * every page here is framed by, so a regression in it is visible on all of
 * them at once.
 *
 * No `ButtonUser` and no sign-in affordance, unlike the playground's shell.
 * This app has no realm and no session, so an account menu would be a control
 * that cannot do anything.
 *
 * `ButtonDark` rather than `ButtonTheme`: the theme picker reads its list from
 * `uiThemeListAtom` and renders NOTHING while that list has fewer than two
 * entries, so using it here left the top bar with no colour control at all.
 */
export const Layout = () => {
  const state = useRouterState();
  const crumbs = findCrumbs(state.url.pathname);

  return (
    <TooltipProvider>
      <DialogProvider>
        <ColorScheme />
        <AppShell
          variant="floating"
          topbarActions={<ButtonDark />}
          brand={
            <a
              href="/"
              className="flex items-center gap-2 px-2 py-2 font-semibold group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
            >
              <span className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded">
                α
              </span>
              <span className="truncate group-data-[collapsible=icon]:hidden">
                Alepha UI
              </span>
            </a>
          }
          nav={NAV.map((group) => ({
            label: group.label,
            items: group.items.map((it) => ({
              href: it.href,
              label: it.label,
              icon: it.icon,
              active: it.href === state.url.pathname,
            })),
          }))}
          breadcrumbs={crumbs.length ? crumbs : undefined}
        >
          <NestedView />
        </AppShell>
      </DialogProvider>
    </TooltipProvider>
  );
};
