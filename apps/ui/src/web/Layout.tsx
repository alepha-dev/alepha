import { AppShell } from "@alepha/ui/components/app-shell/app-shell";
import { ButtonDark } from "@alepha/ui/components/button-dark/button-dark";
import { ButtonTheme } from "@alepha/ui/components/button-theme/button-theme";
import { TooltipProvider } from "@alepha/ui/components/ui/tooltip";
import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { useStore } from "alepha/react";
import { NestedView, useRouterState } from "alepha/react/router";
import { ColorScheme } from "alepha/react/ui";
import {
  FormInput,
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
  /**
   * An empty label renders the items with no heading above them, which is what
   * puts Home on its own at the top.
   */
  label: string;
  items: NavEntry[];
}

/**
 * Two subjects: the components a page is built FROM, and the pages built out of
 * them. Home sits above both in an unlabelled group.
 *
 * ⚠️ An entry with `children` becomes a COLLAPSIBLE group and its own `href` is
 * ignored, so a parent must never be a destination.
 */
const NAV: NavGroup[] = [
  {
    label: "",
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
        label: "Control",
        icon: SlidersHorizontal,
        children: [
          { href: "/blocks/control/text", label: "Text" },
          { href: "/blocks/control/number", label: "Number" },
          { href: "/blocks/control/date", label: "Date" },
          { href: "/blocks/control/select", label: "Select" },
        ],
      },
      {
        label: "AutoForm",
        icon: FormInput,
        children: [
          { href: "/blocks/auto-form/basic", label: "Basic" },
          { href: "/blocks/auto-form/object", label: "Object" },
          { href: "/blocks/auto-form/array", label: "Array" },
        ],
      },
      { href: "/blocks/table", label: "Table", icon: Table2 },
      {
        label: "Messages",
        icon: MessageSquareWarning,
        children: [
          { href: "/blocks/dialog", label: "Dialog" },
          { href: "/blocks/toast", label: "Toast" },
        ],
      },
      { href: "/blocks/buttons", label: "Buttons", icon: MousePointerClick },
    ],
  },
  {
    label: "Pages",
    items: [
      {
        label: "Auth",
        icon: ShieldCheck,
        children: [
          { href: "/pages/auth/login", label: "Sign in" },
          { href: "/pages/auth/register", label: "Register" },
          { href: "/pages/auth/reset", label: "Reset password" },
          { href: "/pages/auth/verify", label: "Verify email" },
          { href: "/pages/auth/mfa", label: "Second factor" },
        ],
      },
      {
        label: "Account",
        icon: UserCog,
        children: [
          { href: "/pages/account/profile", label: "Profile" },
          { href: "/pages/account/security", label: "Security" },
          { href: "/pages/account/sessions", label: "Sessions" },
          { href: "/pages/account/keys", label: "API keys" },
          { href: "/pages/account/connections", label: "Connections" },
        ],
      },
      {
        label: "Admin",
        icon: LayoutDashboard,
        children: [
          { href: "/pages/admin/dashboard", label: "Dashboard" },
          { href: "/pages/admin/users", label: "Users" },
          { href: "/pages/admin/sessions", label: "Sessions" },
          { href: "/pages/admin/keys", label: "API keys" },
          { href: "/pages/admin/jobs", label: "Jobs" },
          { href: "/pages/admin/files", label: "Files" },
          { href: "/pages/admin/notifications", label: "Notifications" },
          { href: "/pages/admin/parameters", label: "Parameters" },
          { href: "/pages/admin/analytics", label: "Analytics" },
          { href: "/pages/admin/payments", label: "Payments" },
          { href: "/pages/admin/audits", label: "Audit log" },
        ],
      },
    ],
  },
];

const findCrumbs = (pathname: string): { label: string; href?: string }[] => {
  for (const group of NAV) {
    for (const entry of group.items) {
      if (entry.href === pathname) {
        return group.label
          ? [{ label: group.label }, { label: entry.label }]
          : [{ label: entry.label }];
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
 * from `/blocks/shell`, so `AppShell`'s three layouts can be compared on a
 * real page rather than described. That page owns the knobs, and it is the
 * only thing that sets them: a second copy in the top bar was the same three
 * switches writing the same atom, one click from the page that documents
 * them.
 *
 * ⚠️ The `h-svh overflow-hidden` wrapper and `fill` are one mechanism, and
 * every page depends on it. Without `fill`, `AppShell` renders its `<main>` as
 * `flex-1 overflow-auto`: nothing bounds the height, so the DOCUMENT becomes
 * the only scroller and a `Showcase`'s own `overflow-auto` never activates.
 * The header bar and the props panel then scroll away with the preview, which
 * is the one thing they must not do. With `fill`, `main` is
 * `min-h-0 flex-1 overflow-hidden` and the scrolling is the preview's own.
 */
export const Layout = () => {
  const state = useRouterState();
  const [stored] = useStore(shellPrefsAtom);

  // First client render MUST match the server, which never saw localStorage.
  // Reading storage during hydration renders a different tree and React
  // refuses to patch the difference up.
  const [hydrated, setHydrated] = useState(false);
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => setHydrated(true), []);
  const prefs = hydrated ? stored : SHELL_PREFS_DEFAULT;

  const pathname = state.url.pathname;
  const crumbs = findCrumbs(pathname);

  return (
    <TooltipProvider>
      <DialogProvider>
        <ColorScheme />
        <div className="flex h-svh flex-col overflow-hidden">
          <AppShell
            fill
            variant={prefs.variant}
            headerOutside={prefs.headerOutside}
            topbarActions={
              <>
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
                      defaultOpen: entry.children.some((c) =>
                        isActive(c.href, pathname),
                      ),
                      children: entry.children.map((c) => ({
                        href: c.href,
                        label: c.label,
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
            breadcrumbs={
              prefs.breadcrumbs && crumbs.length ? crumbs : undefined
            }
          >
            <div className="flex h-full min-h-0 flex-col">
              <NestedView />
            </div>
          </AppShell>
        </div>
      </DialogProvider>
    </TooltipProvider>
  );
};
