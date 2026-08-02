import type { NavGroup } from "@alepha/ui/components/app-shell/app-shell";
import { ButtonLanguage } from "@alepha/ui/components/button-language/button-language";
import { ButtonTheme } from "@alepha/ui/components/button-theme/button-theme";
import { ButtonUser } from "@alepha/ui/components/button-user/button-user";
import { NavShell } from "@alepha/ui/components/nav-shell/nav-shell";
import { Spotlight } from "@alepha/ui/components/nav-shell/spotlight";
import {
  Boxes,
  Building2,
  CreditCard,
  Files,
  Folder,
  Globe,
  Layers,
  Package,
  Search,
  Sparkles,
  Tag,
  Tags,
} from "lucide-react";
import { useState } from "react";

/**
 * Infer demo group appended after the route-derived nav. The `/admin/demo/*`
 * routes don't exist — this group exists to showcase `AppShell`'s nested
 * `NavItem.children`, and demonstrates `NavShell`'s `extraNav` escape hatch
 * for nav entries that aren't backed by routes.
 */
const CATALOG_DEMO: NavGroup[] = [
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

/**
 * Admin shell. The Identity / Operations nav and breadcrumbs are derived from
 * the route tree (each `$page`'s `nav` metadata) by `<NavShell>`; the nested
 * "Catalog (demo)" group is appended statically via `extraNav`. ⌘K opens the
 * <Spotlight> palette over the same source.
 */
export const AdminLayout = () => {
  const [spotlightOpen, setSpotlightOpen] = useState(false);

  return (
    <>
      <NavShell
        root="admin"
        variant="floating"
        extraNav={CATALOG_DEMO}
        topbarActions={
          <>
            <button
              type="button"
              onClick={() => setSpotlightOpen(true)}
              className="text-muted-foreground hover:bg-accent hover:text-foreground hidden h-8 items-center gap-2 rounded-md border px-2 text-sm transition-colors sm:flex"
            >
              <Search className="size-4 shrink-0" />
              <span>Search…</span>
              <kbd className="bg-muted text-muted-foreground pointer-events-none ml-2 hidden rounded px-1.5 font-mono text-[10px] md:inline">
                ⌘K
              </kbd>
            </button>
            <ButtonLanguage />
            <ButtonTheme />
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
      />
      <Spotlight
        root="admin"
        open={spotlightOpen}
        onOpenChange={setSpotlightOpen}
      />
    </>
  );
};
