import { AppShell } from "@alepha/ui/components/app-shell/app-shell";
import { ButtonLanguage } from "@alepha/ui/components/button-language/button-language";
import { ButtonTheme } from "@alepha/ui/components/button-theme/button-theme";
import { ButtonUser } from "@alepha/ui/components/button-user/button-user";
import { TooltipProvider } from "@alepha/ui/components/ui/tooltip";
import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { NestedView, useRouter, useRouterState } from "alepha/react/router";
import { ColorScheme } from "alepha/react/ui";
import {
  Bell,
  Calendar,
  CreditCard,
  FileSearch,
  KeyRound,
  ListChecks,
  Megaphone,
  MessageSquareWarning,
  Upload,
  UserPlus,
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
  {
    label: "Forms gallery",
    items: [
      { href: "/demo/forms/login", label: "Login", icon: KeyRound },
      { href: "/demo/forms/register", label: "Register", icon: UserPlus },
      { href: "/demo/forms/payment", label: "Payment", icon: CreditCard },
      { href: "/demo/forms/upload", label: "Upload", icon: Upload },
      { href: "/demo/forms/dates", label: "Dates", icon: Calendar },
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
  const router = useRouter();

  return (
    <TooltipProvider>
      <DialogProvider>
        <ColorScheme />
        <AppShell
          variant="floating"
          topbarActions={
            <>
              <ButtonLanguage />
              <ButtonTheme />
              <ButtonUser
                onSignIn={() => router.push("/auth/login")}
                onAdminClick={() => router.push("/admin/users")}
              />
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
