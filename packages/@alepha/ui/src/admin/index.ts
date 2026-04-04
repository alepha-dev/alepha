/**
 * Generic admin UI framework.
 *
 * Provides the admin layout shell, `$uiAdmin` primitive for explicit
 * page composition, and shared components for building admin pages.
 *
 * Domain-specific admin pages are provided by sub-modules:
 * - `@alepha/ui/admin-users`
 * - `@alepha/ui/admin-sessions`
 * - `@alepha/ui/admin-audits`
 * - `@alepha/ui/admin-files`
 * - `@alepha/ui/admin-parameters`
 * - `@alepha/ui/admin-jobs`
 * - `@alepha/ui/admin-keys`
 * - `@alepha/ui/admin-notifications`
 * - `@alepha/ui/admin-payments`
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
