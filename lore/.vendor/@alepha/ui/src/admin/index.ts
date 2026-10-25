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
  AdminDashboardCountCard,
  type AdminDashboardCountCardProps,
} from "./AdminDashboardCountCard.tsx";
export { AdminFiles } from "./AdminFiles.tsx";
export { AdminJobDetail, type AdminJobDetailProps } from "./AdminJobDetail.tsx";
export { AdminJobs } from "./AdminJobs.tsx";
export { AdminKeys } from "./AdminKeys.tsx";
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
export { AdminUsers, type AdminUsersProps } from "./AdminUsers.tsx";
export { useConfirmedAction } from "./useConfirmedAction.tsx";
