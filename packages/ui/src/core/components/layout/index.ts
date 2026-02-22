import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

export type { AlephaMantineProviderProps } from "../AlephaMantineProvider.tsx";
export { default as AlephaMantineProvider } from "../AlephaMantineProvider.tsx";
export type {
  AppBarBack,
  AppBarBurger,
  AppBarDark,
  AppBarDivider,
  AppBarElement,
  AppBarItem,
  AppBarLang,
  AppBarLogo,
  AppBarProps,
  AppBarSearch,
  AppBarSpacer,
} from "./AppBar.tsx";
export { default as AppBar } from "./AppBar.tsx";
export type { BreadcrumbProps } from "./Breadcrumb.tsx";
export { default as Breadcrumbs } from "./Breadcrumb.tsx";
export type { ContainerProps } from "./Container.tsx";
export { default as Container } from "./Container.tsx";
export {
  type DashboardShellProps,
  type DashboardShellProps as AdminShellProps,
  default as DashboardShell,
  default as AdminShell,
} from "./DashboardShell.tsx";
export type { OmnibarProps } from "./Omnibar.tsx";
export { default as Omnibar } from "./Omnibar.tsx";
export type {
  SidebarAbstractItem,
  SidebarButtonTheme,
  SidebarDivider,
  SidebarElement,
  SidebarItemProps,
  SidebarMenuItem,
  SidebarNode,
  SidebarProps,
  SidebarSearch,
  SidebarSection,
  SidebarSpacer,
  SidebarTheme,
} from "./Sidebar.tsx";
export { Sidebar } from "./Sidebar.tsx";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Layout components for building application shells.
 *
 * **Features:**
 * - DashboardShell with resizable sidebar
 * - AppBar with configurable elements
 * - Sidebar navigation with sections and menu items
 * - Breadcrumb navigation
 * - Omnibar (command palette)
 *
 * @module alepha.ui.layout
 */
export const AlephaUILayout = $module({
  name: "alepha.ui.layout",
});
