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
 */
export const playgroundAdminOptions: AdminRouterOptions = {
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
