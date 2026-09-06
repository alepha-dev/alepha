import {
  FormInput,
  Home as HomeIcon,
  ListTree,
  LayoutDashboard,
  MessageSquareWarning,
  MousePointerClick,
  PanelsTopLeft,
  ShieldCheck,
  SlidersHorizontal,
  Table2,
  UserCog,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

export interface NavLeaf {
  href: string;
  label: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
}

export interface NavEntry {
  label: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  href?: string;
  children?: NavLeaf[];
}

export interface NavGroup {
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
 * Lives here rather than in `Layout.tsx` because the sidebar is no longer its
 * only reader: the home page's command palette walks the same tree, and a
 * second hand-written list is how a page ends up reachable from one and not the
 * other.
 *
 * ⚠️ An entry with `children` becomes a COLLAPSIBLE group and its own `href` is
 * ignored, so a parent must never be a destination.
 */
export const NAV: NavGroup[] = [
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
          { href: "/blocks/detail", label: "Detail" },
          { href: "/blocks/plate", label: "Plate" },
          { href: "/blocks/settings", label: "Settings" },
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
      { href: "/blocks/tree", label: "Tree", icon: ListTree },
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

export interface NavDestination {
  href: string;
  label: string;
  /**
   * The group heading the destination sits under, empty for the ungrouped top.
   */
  group: string;
  /**
   * The collapsible entry it sits under, absent for a top-level destination.
   * Carried so a palette row can say `Sidebar` under `Layout` rather than
   * `Sidebar` on its own, and so typing the parent's name finds its children.
   */
  parent?: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
}

/**
 * {@link NAV} with its groups flattened to the pages a reader can actually
 * open.
 *
 * Derived rather than written out a second time: the palette and the sidebar
 * then cannot disagree about what exists, and a page added to `NAV` is
 * searchable the moment it is navigable. Leaves inherit their parent's icon,
 * which is the only icon the tree carries.
 */
export const NAV_DESTINATIONS: NavDestination[] = NAV.flatMap((group) =>
  group.items.flatMap((entry) =>
    entry.children
      ? entry.children.map((child) => ({
          href: child.href,
          label: child.label,
          group: group.label,
          parent: entry.label,
          icon: entry.icon,
        }))
      : [
          {
            href: entry.href ?? "",
            label: entry.label,
            group: group.label,
            icon: entry.icon,
          },
        ],
  ),
);

/**
 * The breadcrumb trail for a pathname, read off the same tree the sidebar
 * renders. Empty when the path is not in it.
 */
export const findCrumbs = (
  pathname: string,
): { label: string; href?: string }[] => {
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
