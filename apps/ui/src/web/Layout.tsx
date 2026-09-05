import { AppShell } from "@alepha/ui/components/app-shell/app-shell";
import { ButtonDark } from "@alepha/ui/components/button-dark/button-dark";
import { ButtonTheme } from "@alepha/ui/components/button-theme/button-theme";
import { TooltipProvider } from "@alepha/ui/components/ui/tooltip";
import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { useStore } from "alepha/react";
import { NestedView, useRouterState } from "alepha/react/router";
import { ColorScheme } from "alepha/react/ui";
import {
  Home as HomeIcon,
  LayoutDashboard,
  MessageSquareWarning,
  MousePointerClick,
  PanelsTopLeft,
  ShieldCheck,
  SlidersHorizontal,
  Table2,
  UserCog,
} from "lucide-react";
import { type ComponentType, type SVGProps, useEffect, useState } from "react";

import { ShellTweak } from "@/web/components/ShellTweak.tsx";
import { SHELL_PREFS_DEFAULT, shellPrefsAtom } from "@/web/shellPrefsAtom.ts";

interface NavLeaf {
  href: string;
  label: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
}

interface NavEntry {
  label: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  href?: string;
  children?: NavLeaf[];
}

interface NavGroup {
  label: string;
  items: NavEntry[];
}

/**
 * ⚠️ An entry with `children` becomes a COLLAPSIBLE group and its own `href` is
 * ignored, so a parent must never be a destination. That is what keeps this
 * readable at 25+ pages: three flat groups would be a wall.
 */
const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [{ href: "/", label: "Home", icon: HomeIcon }],
  },
  {
    label: "Blocks",
    items: [
      {
        label: "Layout",
        icon: PanelsTopLeft,
        children: [
          { href: "/blocks/shell", label: "App shell" },
          { href: "/blocks/sidebar", label: "Sidebar" },
        ],
      },
      {
        label: "Forms",
        icon: SlidersHorizontal,
        children: [
          { href: "/blocks/controls", label: "Controls" },
          { href: "/blocks/select", label: "Select" },
          { href: "/blocks/auto-form", label: "AutoForm" },
        ],
      },
      { href: "/blocks/table", label: "AlephaTable", icon: Table2 },
      {
        href: "/blocks/feedback",
        label: "Toasts & dialogs",
        icon: MessageSquareWarning,
      },
      { href: "/blocks/buttons", label: "Buttons", icon: MousePointerClick },
    ],
  },
  {
    label: "Auth",
    items: [
      { href: "/blocks/auth", label: "Sign in & register", icon: ShieldCheck },
      { href: "/blocks/account", label: "Account", icon: UserCog },
    ],
  },
  {
    label: "Admin",
    items: [
      {
        label: "Admin surface",
        icon: LayoutDashboard,
        children: [
          { href: "/blocks/admin/dashboard", label: "Dashboard" },
          { href: "/blocks/admin/users", label: "Users" },
          { href: "/blocks/admin/sessions", label: "Sessions" },
          { href: "/blocks/admin/keys", label: "API keys" },
          { href: "/blocks/admin/jobs", label: "Jobs" },
          { href: "/blocks/admin/files", label: "Files" },
          { href: "/blocks/admin/notifications", label: "Notifications" },
          { href: "/blocks/admin/parameters", label: "Parameters" },
          { href: "/blocks/admin/analytics", label: "Analytics" },
          { href: "/blocks/admin/payments", label: "Payments" },
          { href: "/blocks/admin/audits", label: "Audit log" },
        ],
      },
    ],
  },
];

const findCrumbs = (pathname: string): { label: string; href?: string }[] => {
  for (const group of NAV) {
    for (const entry of group.items) {
      if (entry.href === pathname) {
        return [{ label: group.label }, { label: entry.label }];
      }
      const child = entry.children?.find((c) => c.href === pathname);
      if (child) {
        return [
          { label: group.label },
          { label: entry.label },
          { label: child.label },
        ];
      }
    }
  }
  return [];
};

const isActive = (href: string, pathname: string) => href === pathname;

/**
 * The shell, and itself a specimen.
 *
 * Its variant comes from a `persist: "localStorage"` atom the reader drives
 * from the top bar, so `AppShell`'s three layouts can be compared on a real
 * page rather than described. See `ShellTweak`.
 *
 * `ButtonTheme` is back in the top bar beside `ButtonDark`, because `UiThemes`
 * now registers six themes: the picker hides itself below two, which is why an
 * earlier version of this file had to use `ButtonDark` alone.
 */
export const Layout = () => {
  const state = useRouterState();
  const [stored] = useStore(shellPrefsAtom);

  // ⚠️ First client render MUST match the server, which never saw localStorage.
  // Reading the stored value straight away produces a different tree and React
  // refuses to patch the difference up, leaving `data-variant` disagreeing with
  // what React thinks it rendered. So the default paints once, then the stored
  // preference lands on the next pass.
  const [hydrated, setHydrated] = useState(false);
  // Deliberate, and the rule's own escape: an effect is right "when
  // synchronizing with an external system", and web storage is one that does
  // not exist until the browser takes over. The extra render IS the mechanism -
  // it is what makes the first pass match the server.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => setHydrated(true), []);
  const prefs = hydrated ? stored : SHELL_PREFS_DEFAULT;

  const pathname = state.url.pathname;
  const crumbs = findCrumbs(pathname);

  return (
    <TooltipProvider>
      <DialogProvider>
        <ColorScheme />
        <AppShell
          variant={prefs.variant}
          headerOutside={prefs.headerOutside}
          topbarActions={
            <>
              <ShellTweak />
              <ButtonTheme />
              <ButtonDark />
            </>
          }
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
            items: group.items.map((entry) =>
              entry.children
                ? {
                    label: entry.label,
                    icon: entry.icon,
                    // Open when the reader is inside it, so a deep link does
                    // not land on a collapsed group with no visible context.
                    defaultOpen: entry.children.some((c) =>
                      isActive(c.href, pathname),
                    ),
                    children: entry.children.map((c) => ({
                      href: c.href,
                      label: c.label,
                      icon: c.icon,
                      active: isActive(c.href, pathname),
                    })),
                  }
                : {
                    href: entry.href,
                    label: entry.label,
                    icon: entry.icon,
                    active: isActive(entry.href ?? "", pathname),
                  },
            ),
          }))}
          breadcrumbs={prefs.breadcrumbs && crumbs.length ? crumbs : undefined}
        >
          <NestedView />
        </AppShell>
      </DialogProvider>
    </TooltipProvider>
  );
};
