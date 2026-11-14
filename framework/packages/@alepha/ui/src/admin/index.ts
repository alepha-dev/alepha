/**
 * The back office.
 *
 * `AdminRouter` mounts a dashboard, users, sessions, API keys, jobs,
 * notifications, audits, files, parameters, payments and analytics, each page its
 * own lazy chunk, and each hidden when the server does not register its actions
 * or the admin does not hold its permission. `$pageAdmin` adds a page to the same
 * shell. The pages are exported by name too, for an app that routes them itself.
 *
 * @module alepha.ui.admin
 */

export { $pageAdmin } from "./$pageAdmin.tsx";
export {
  AdminAnalytics,
  type AdminAnalyticsProps,
  type AnalyticsTransport,
} from "./AdminAnalytics.tsx";
export { AdminAudits } from "./AdminAudits.tsx";
export {
  default as AdminDashboard,
  type AdminDashboardProps,
} from "./AdminDashboard.tsx";
export type { AdminDashboardCard } from "./AdminDashboardCard.tsx";
export {
  ADMIN_BUILTIN_DASHBOARD_CARD_IDS,
  adminDashboardCardIdProblem,
  type AdminDashboardLayoutEntry,
  type AdminDashboardLayoutTile,
  adminDashboardCatalog,
  adminDashboardLayoutEntries,
  adminDashboardLayoutOf,
  resolveAdminDashboardLayout,
} from "./adminDashboardLayout.ts";
export {
  AdminConnectedTile,
  type AdminConnectedTileProps,
} from "./AdminConnectedTile.tsx";
export {
  type AdminDashboardDayWindow,
  adminAuditDayRange,
  adminDashboardDayWindow,
} from "./adminDashboardWindows.ts";
export {
  AdminFailedSignInsTile,
  type AdminFailedSignInsTileProps,
} from "./AdminFailedSignInsTile.tsx";
export { AdminFiles } from "./AdminFiles.tsx";
export {
  AdminStatTile,
  type AdminStatTileDelta,
  type AdminStatTileLoaded,
  type AdminStatTileProps,
  type AdminStatTileResult,
} from "./AdminStatTile.tsx";
export {
  AdminStatTileDeltaChip,
  type AdminStatTileDeltaChipProps,
} from "./AdminStatTileDeltaChip.tsx";
export {
  type AdminStatTileDeltaChange,
  adminStatTileDelta,
  formatAdminStatTileDelta,
} from "./adminStatTileDelta.ts";
export { AdminJobDetail, type AdminJobDetailProps } from "./AdminJobDetail.tsx";
export { AdminJobs } from "./AdminJobs.tsx";
export { AdminKeys } from "./AdminKeys.tsx";
export { AdminBrand, type AdminBrandProps } from "./AdminBrand.tsx";
export { AdminLayout } from "./AdminLayout.tsx";
export { AdminNotifications } from "./AdminNotifications.tsx";
export { AdminPage, type AdminPageProps } from "./AdminPage.tsx";
export {
  AdminParameters,
  type AdminParametersProps,
} from "./AdminParameters.tsx";
export { AdminPayments } from "./AdminPayments.tsx";
export { AdminRouter } from "./AdminRouter.tsx";
export {
  type AdminRouterOptions,
  adminRouterOptionsAtom,
} from "./AdminRouterOptions.tsx";
export { AdminSessions } from "./AdminSessions.tsx";
export {
  AdminUserDetail,
  type AdminUserDetailProps,
} from "./AdminUserDetail.tsx";
export { AdminWebhookDetail } from "./AdminWebhookDetail.tsx";
export { AdminWebhooks } from "./AdminWebhooks.tsx";
export { AdminUsersTile, type AdminUsersTileProps } from "./AdminUsersTile.tsx";
export { AdminUsers, type AdminUsersProps } from "./AdminUsers.tsx";
export { useConfirmedAction } from "./useConfirmedAction.tsx";
