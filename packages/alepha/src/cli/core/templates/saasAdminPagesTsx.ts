/**
 * Admin pages — each is a thin wrapper around the matching `admin-*`
 * registry component (placed at `src/components/admin/*`). The starter
 * ships with Users + Sessions; add more by `shadcn add @alepha/admin-…`
 * and a matching `$page(...)` in AppRouter.
 */

export const saasAdminUsersTsx = () =>
  `import { AdminUsers } from "@/components/admin/admin-users";

const AdminUsersPage = () => {
  return <AdminUsers />;
};

export default AdminUsersPage;
`;

export const saasAdminSessionsTsx = () =>
  `import { AdminSessions } from "@/components/admin/admin-sessions";

const AdminSessionsPage = () => {
  return <AdminSessions />;
};

export default AdminSessionsPage;
`;
