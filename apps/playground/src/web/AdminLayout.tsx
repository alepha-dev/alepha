import type { NavGroup, NavItem } from "@alepha/ui/components/app-shell/app-shell";
import { AppShell } from "@alepha/ui/components/app-shell/app-shell";
import { ButtonLanguage } from "@alepha/ui/components/button-language/button-language";
import { ButtonUser } from "@alepha/ui/components/button-user/button-user";
import { ThemeToggle } from "@alepha/ui/components/theme-toggle";
import { TooltipProvider } from "@alepha/ui/components/ui/tooltip";
import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { NestedView, useRouterState } from "alepha/react/router";
import {
  Bell,
  Boxes,
  Building2,
  CreditCard,
  Files,
  Folder,
  Globe,
  KeyRound,
  Layers,
  Package,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Tag,
  Tags,
  Timer,
  Users,
} from "lucide-react";

const NAV: NavGroup[] = [
  {
    label: "Identity",
    items: [
      { href: "/admin/users", label: "Users", icon: Users },
      { href: "/admin/sessions", label: "Sessions", icon: ShieldCheck },
      { href: "/admin/keys", label: "API keys", icon: KeyRound },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/admin/jobs", label: "Jobs", icon: Timer },
      { href: "/admin/notifications", label: "Notifications", icon: Bell },
      { href: "/admin/audits", label: "Audit log", icon: ShieldAlert },
      { href: "/admin/files", label: "Files", icon: Files },
      { href: "/admin/parameters", label: "Parameters", icon: Settings2 },
    ],
  },
  // Fake catalog group to demonstrate nested NavItem children.
  {
    label: "Catalog (demo)",
    items: [
      {
        label: "Products",
        icon: Package,
        children: [
          { href: "/admin/demo/products/all", label: "All", icon: Boxes },
          {
            href: "/admin/demo/products/featured",
            label: "Featured",
            icon: Sparkles,
          },
          {
            label: "Categories",
            icon: Folder,
            children: [
              {
                href: "/admin/demo/products/cat/electronics",
                label: "Electronics",
                icon: Layers,
              },
              {
                href: "/admin/demo/products/cat/apparel",
                label: "Apparel",
                icon: Tag,
              },
              {
                href: "/admin/demo/products/cat/home",
                label: "Home",
                icon: Tags,
              },
            ],
          },
        ],
      },
      {
        label: "Billing",
        icon: CreditCard,
        children: [
          { href: "/admin/demo/billing/plans", label: "Plans", icon: Layers },
          {
            href: "/admin/demo/billing/invoices",
            label: "Invoices",
            icon: Files,
          },
        ],
      },
      {
        label: "Tenants",
        icon: Building2,
        children: [
          { href: "/admin/demo/tenants/active", label: "Active", icon: Globe },
          {
            href: "/admin/demo/tenants/archived",
            label: "Archived",
            icon: Folder,
          },
        ],
      },
    ],
  },
];

const findInItems = (
  items: NavItem[],
  pathname: string,
  trail: string[],
): { trail: string[]; match: NavItem } | null => {
  for (const it of items) {
    const next = [...trail, it.label];
    if (it.href === pathname) return { trail: next, match: it };
    if (it.children) {
      const found = findInItems(it.children, pathname, next);
      if (found) return found;
    }
  }
  return null;
};

const findCrumbs = (pathname: string): { label: string; href?: string }[] => {
  for (const group of NAV) {
    const found = findInItems(group.items, pathname, []);
    if (found) {
      return [
        { label: "Admin", href: "/admin" },
        { label: group.label ?? "" },
        ...found.trail.map((l) => ({ label: l })),
      ];
    }
  }
  return [{ label: "Admin", href: "/admin" }];
};

const markActive = (items: NavItem[], pathname: string): NavItem[] =>
  items.map((it) => ({
    ...it,
    active: it.href === pathname,
    children: it.children ? markActive(it.children, pathname) : undefined,
  }));

export const AdminLayout = () => {
  const state = useRouterState();
  const crumbs = findCrumbs(state.url.pathname);

  return (
    <TooltipProvider>
      <DialogProvider>
        <AppShell
          variant="floating"
          topbarActions={
            <>
              <ButtonLanguage />
              <ThemeToggle />
              <ButtonUser />
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
                Alepha Admin
              </span>
            </a>
          }
          nav={NAV.map((group) => ({
            label: group.label,
            items: markActive(group.items, state.url.pathname),
          }))}
          breadcrumbs={crumbs}
        >
          <NestedView />
        </AppShell>
      </DialogProvider>
    </TooltipProvider>
  );
};
