/**
 * Generic admin UI framework.
 *
 * Provides the admin layout shell, `$uiAdmin` primitive for explicit
 * page composition, and shared components for building admin pages.
 *
 * Domain-specific admin pages are provided by sub-modules:
 * - `@alepha/mantine/admin-users`
 * - `@alepha/mantine/admin-sessions`
 * - `@alepha/mantine/admin-audits`
 * - `@alepha/mantine/admin-files`
 * - `@alepha/mantine/admin-parameters`
 * - `@alepha/mantine/admin-jobs`
 * - `@alepha/mantine/admin-keys`
 * - `@alepha/mantine/admin-notifications`
 * - `@alepha/mantine/admin-payments`
 *
 * @module alepha.ui.admin
 */

export { default as AdminLayout } from "./components/AdminLayout.tsx";
export {
  type AdminResourceAction,
  type AdminResourceHeaderProps,
  default as AdminResourceHeader,
} from "./components/shared/AdminResourceHeader.tsx";
export {
  type AdminResourceTab,
  type AdminResourceTabsProps,
  default as AdminResourceTabs,
} from "./components/shared/AdminResourceTabs.tsx";
export {
  $uiAdmin,
  type AdminSidebarItem,
  type AdminSidebarSection,
  type UiAdminOptions,
} from "./primitives/$uiAdmin.ts";
