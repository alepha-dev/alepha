import { AppShell } from "@alepha/ui/components/app-shell";
import { ThemeToggle } from "@alepha/ui/components/theme-toggle";
import { TooltipProvider } from "@alepha/ui/components/ui/tooltip";
import { DialogProvider } from "@alepha/ui/components/use-dialog";
import { NestedView, useRouterState } from "alepha/react/router";
import { ColorScheme } from "alepha/react/ui";
import {
  Bell,
  FileSearch,
  Files,
  ListChecks,
  Megaphone,
  MessageSquareWarning,
  Settings2,
  ShieldAlert,
  Timer,
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
    label: "Resources",
    items: [
      { href: "/resources/jobs", label: "Jobs", icon: Timer },
      { href: "/resources/notifications", label: "Notifications", icon: Bell },
      { href: "/resources/audits", label: "Audit log", icon: ShieldAlert },
      { href: "/resources/files", label: "Files", icon: Files },
      { href: "/resources/parameters", label: "Parameters", icon: Settings2 },
    ],
  },
  {
    label: "Playgrounds",
    items: [
      { href: "/playgrounds/jobs", label: "Jobs", icon: Zap },
      {
        href: "/playgrounds/notifications",
        label: "Notifications",
        icon: Bell,
      },
      { href: "/playgrounds/audits", label: "Audits", icon: FileSearch },
    ],
  },
  {
    label: "Demo",
    items: [
      { href: "/demo/toasts", label: "Toasts", icon: Megaphone },
      { href: "/demo/dialogs", label: "Dialogs", icon: MessageSquareWarning },
      { href: "/demo/auto-form", label: "AutoForm", icon: ListChecks },
      { href: "/demo/forms", label: "Form gallery", icon: ListChecks },
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

export const Layout = () => {
  const state = useRouterState();
  const crumbs = findCrumbs(state.url.pathname);

  return (
    <TooltipProvider>
      <DialogProvider>
        <ColorScheme />
        <AppShell
          variant={"floating"}
          topbarActions={<ThemeToggle />}
          brand={
            <a
              href="/"
              className="flex items-center gap-2 px-2 py-2 font-semibold group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
            >
              <span className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded">
                α
              </span>
              <span className="truncate group-data-[collapsible=icon]:hidden">
                Alepha Playground
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
