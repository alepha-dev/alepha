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
  /**
   * One line saying what the page shows, for the command palette's second
   * row. Taken from the page's own subtitle, so the palette and the page
   * agree about what the reader is about to open.
   */
  description?: string;
}

export interface NavEntry {
  label: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  href?: string;
  /**
   * See {@link NavLeaf.description}. Ignored on an entry with `children`,
   * which is a toggle rather than a destination.
   */
  description?: string;
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
    items: [
      {
        href: "/",
        label: "Home",
        icon: HomeIcon,
        description:
          "Every component in @alepha/ui, rendered with its variants.",
      },
    ],
  },
  {
    label: "Blocks",
    items: [
      {
        label: "Layout",
        icon: PanelsTopLeft,
        children: [
          {
            href: "/blocks/shell",
            label: "App shell",
            description:
              "The frame an application mounts once, in three variants.",
          },
          {
            href: "/blocks/sidebar",
            label: "Sidebar",
            description: "The navigation rail, as its own specimen.",
          },
          {
            href: "/blocks/detail",
            label: "Detail",
            description: "Identity column, tab toolbar, tab body.",
          },
          {
            href: "/blocks/plate",
            label: "Plate",
            description:
              "A full-width plate over a tab strip, and a body under both.",
          },
          {
            href: "/blocks/settings",
            label: "Settings",
            description: "Sticky rail, cards of rows, and a danger zone.",
          },
        ],
      },
      {
        label: "Control",
        icon: SlidersHorizontal,
        children: [
          {
            href: "/blocks/control/text",
            label: "Text",
            description: "Every shape z.string() takes.",
          },
          {
            href: "/blocks/control/number",
            label: "Number",
            description: "Integers, decimals, bounds and the switch.",
          },
          {
            href: "/blocks/control/date",
            label: "Date",
            description: "Calendar, clock, and both together.",
          },
          {
            href: "/blocks/control/select",
            label: "Select",
            description: "Every shape one control takes.",
          },
        ],
      },
      {
        label: "AutoForm",
        icon: FormInput,
        children: [
          {
            href: "/blocks/auto-form/basic",
            label: "Basic",
            description: "A whole form rendered from a flat schema.",
          },
          {
            href: "/blocks/auto-form/object",
            label: "Object",
            description: "Nested groups, and optional versus required.",
          },
          {
            href: "/blocks/auto-form/array",
            label: "Array",
            description: "Tag lists, multi-selects and repeated groups.",
          },
        ],
      },
      {
        href: "/blocks/table",
        label: "Table",
        icon: Table2,
        description: "Server-paged, filtered and sortable.",
      },
      {
        href: "/blocks/tree",
        label: "Tree",
        icon: ListTree,
        description: "One tree, three capability tiers.",
      },
      {
        label: "Messages",
        icon: MessageSquareWarning,
        children: [
          {
            href: "/blocks/dialog",
            label: "Dialog",
            description: "Blocking questions, as promises.",
          },
          {
            href: "/blocks/toast",
            label: "Toast",
            description: "Transient feedback, stacked and auto-dismissed.",
          },
        ],
      },
      {
        href: "/blocks/buttons",
        label: "Buttons",
        icon: MousePointerClick,
        description: "Every variant, at the size you pick.",
      },
    ],
  },
  {
    label: "Pages",
    items: [
      {
        label: "Auth",
        icon: ShieldCheck,
        children: [
          {
            href: "/pages/auth/login",
            label: "Sign in",
            description: "AuthLogin, centred or split.",
          },
          {
            href: "/pages/auth/register",
            label: "Register",
            description: "AuthRegister, driven by the realm's required fields.",
          },
          {
            href: "/pages/auth/reset",
            label: "Reset password",
            description: "AuthResetPassword, at its first step.",
          },
          {
            href: "/pages/auth/verify",
            label: "Verify email",
            description: "AuthVerifyEmail, in each of its three outcomes.",
          },
          {
            href: "/pages/auth/mfa",
            label: "Second factor",
            description: "AuthMfaStep, for a code sent or generated.",
          },
        ],
      },
      {
        label: "Account",
        icon: UserCog,
        children: [
          {
            href: "/pages/account/profile",
            label: "Profile",
            description: "Name, email and the roles a realm granted.",
          },
          {
            href: "/pages/account/security",
            label: "Security",
            description: "Password, second factor, linked providers, deletion.",
          },
          {
            href: "/pages/account/sessions",
            label: "Sessions",
            description: "Every device this account is signed in on.",
          },
          {
            href: "/pages/account/keys",
            label: "API keys",
            description: "Personal tokens, live and revoked.",
          },
          {
            href: "/pages/account/connections",
            label: "Connections",
            description: "Authorised applications and their scopes.",
          },
        ],
      },
      {
        label: "Admin",
        icon: LayoutDashboard,
        children: [
          {
            href: "/pages/admin/dashboard",
            label: "Dashboard",
            description: "The admin landing page.",
          },
          {
            href: "/pages/admin/users",
            label: "Users",
            description: "The user directory.",
          },
          {
            href: "/pages/admin/sessions",
            label: "Sessions",
            description: "Where people are signed in.",
          },
          {
            href: "/pages/admin/keys",
            label: "API keys",
            description: "Programmatic access tokens.",
          },
          {
            href: "/pages/admin/jobs",
            label: "Jobs",
            description: "Registered jobs and their runs.",
          },
          {
            href: "/pages/admin/files",
            label: "Files",
            description: "Stored files across buckets.",
          },
          {
            href: "/pages/admin/notifications",
            label: "Notifications",
            description: "The delivery log.",
          },
          {
            href: "/pages/admin/parameters",
            label: "Parameters",
            description: "Runtime configuration, versioned.",
          },
          {
            href: "/pages/admin/analytics",
            label: "Analytics",
            description: "An explorer over declared datasets.",
          },
          {
            href: "/pages/admin/payments",
            label: "Payments",
            description: "Payment intents.",
          },
          {
            href: "/pages/admin/audits",
            label: "Audit log",
            description: "The audit trail.",
          },
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
  description?: string;
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
          description: child.description,
        }))
      : [
          {
            href: entry.href ?? "",
            label: entry.label,
            group: group.label,
            icon: entry.icon,
            description: entry.description,
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
