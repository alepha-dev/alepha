import type { AdminRouterOptions } from "@alepha/ui/components/admin/admin-router-options";
import {
  Boxes,
  Building2,
  CreditCard,
  Files,
  Folder,
  Globe,
  Layers,
  Package,
  Sparkles,
  Tag,
  Tags,
} from "lucide-react";

/**
 * Playground's admin chrome. The nested group is not a real route subtree —
 * it exists to exercise `AppShell`'s nested `NavItem.children` and
 * `NavShell`'s `extraNav` escape hatch, which the shared router forwards.
 *
 * `brand` restores the link-out the deleted `AdminLayout.tsx` had — without
 * it, the default shell brand is a plain non-clickable `<div>` and there is
 * no way out of `/admin` by clicking the logo.
 */
export const playgroundAdminOptions: AdminRouterOptions = {
  brand: (
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
  ),
  extraNav: [
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
            {
              href: "/admin/demo/billing/plans",
              label: "Plans",
              icon: Layers,
            },
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
            {
              href: "/admin/demo/tenants/active",
              label: "Active",
              icon: Globe,
            },
            {
              href: "/admin/demo/tenants/archived",
              label: "Archived",
              icon: Folder,
            },
          ],
        },
      ],
    },
  ],
};
