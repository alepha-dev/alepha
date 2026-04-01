import type {
  AppBarItem,
  DashboardShellProps,
  SidebarNode,
  SidebarSection,
} from "@alepha/ui";
import { AuthRouter } from "@alepha/ui/auth";
import { $context } from "alepha";
import {
  $page,
  PagePrimitive,
  ReactRouter,
  Redirection,
} from "alepha/react/router";
import { $secure } from "alepha/security";

// ---------------------------------------------------------------------------------------------------------------------

export interface UiAdminOptions {
  /**
   * Root pages to parent under the admin layout.
   * List the root page of each domain router. Internal child pages
   * (those with a parent already set) follow automatically.
   */
  pages: PagePrimitive<any, any, any>[];

  /**
   * Sidebar navigation items.
   * Accepts $page references (resolved to SidebarNodes), raw SidebarNodes,
   * or section groups with label + children.
   */
  sidebarItems: AdminSidebarItem[];

  /**
   * AppBar items displayed in the admin header.
   */
  appBarItems?: AppBarItem[];

  /**
   * Additional DashboardShell props for the admin layout.
   */
  shellProps?: Partial<DashboardShellProps>;
}

export type AdminSidebarItem =
  | PagePrimitive
  | SidebarNode
  | AdminSidebarSection;

export interface AdminSidebarSection {
  label: string;
  icon?: SidebarSection["icon"];
  children: AdminSidebarItem[];
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Create an admin panel with explicit page composition and sidebar configuration.
 *
 * Pages listed in `pages` are parented under the admin layout (`/admin`).
 * Sidebar items that reference a `$page` are resolved to `SidebarNode` objects.
 */
export const $uiAdmin = (options: UiAdminOptions) => {
  const { alepha } = $context();
  const router = alepha.inject(ReactRouter<any>);
  const authRouter = alepha.inject(AuthRouter);

  const adminLayout = $page({
    name: "adminLayout",
    path: "/admin",
    label: "Admin",
    head: {
      title: "Admin Panel",
      titleSeparator: " | ",
    },
    use: [
      $secure({
        permissions: ["admin:access"],
      }),
    ],
    lazy: () => import("../components/AdminLayout.tsx"),
    props: () => ({
      adminShellProps: buildShellProps(router, options),
    }),
    loader: (ctx: any) => {
      if (!ctx.user) {
        throw new Redirection(
          router.path(authRouter.login.name, {
            query: { r: ctx.url.pathname },
          }),
        );
      }
      return {};
    },
  });

  // Parent all listed root pages under adminLayout
  for (const page of options.pages) {
    (page.options as { parent?: PagePrimitive }).parent = adminLayout;
  }

  return adminLayout;
};

// ---------------------------------------------------------------------------------------------------------------------

function resolveSidebarItems(
  router: ReactRouter<any>,
  items: AdminSidebarItem[],
): SidebarNode[] {
  return items.map((item) => {
    if (item instanceof PagePrimitive) {
      return router.node(item.name) as SidebarNode;
    }
    if (isAdminSidebarSection(item)) {
      return {
        label: item.label,
        icon: item.icon,
        children: resolveSidebarItems(router, item.children),
      } as SidebarNode;
    }
    return item as SidebarNode;
  });
}

function isAdminSidebarSection(
  item: AdminSidebarItem,
): item is AdminSidebarSection {
  return (
    typeof item === "object" &&
    item !== null &&
    "children" in item &&
    "label" in item &&
    Array.isArray((item as AdminSidebarSection).children)
  );
}

function buildShellProps(
  router: ReactRouter<any>,
  options: UiAdminOptions,
): DashboardShellProps {
  return {
    ...options.shellProps,
    sidebarProps: {
      ...options.shellProps?.sidebarProps,
      items: resolveSidebarItems(router, options.sidebarItems),
    },
  };
}
