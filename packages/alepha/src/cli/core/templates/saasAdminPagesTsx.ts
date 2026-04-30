/**
 * Admin pages — each is a thin wrapper around the matching `admin-*`
 * registry component (placed at `src/components/admin/*`). Drop-in
 * replacements once you `shadcn add` more.
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

export const saasAdminApiKeysTsx = () =>
  `import { AdminApiKeys } from "@/components/admin/admin-keys";

const AdminApiKeysPage = () => {
  return <AdminApiKeys />;
};

export default AdminApiKeysPage;
`;

export const saasAdminParametersTsx = () =>
  `import { AdminParameters } from "@/components/admin/admin-parameters";

const AdminParametersPage = () => {
  return <AdminParameters />;
};

export default AdminParametersPage;
`;

export const saasAdminAuditsTsx = () =>
  `import { AdminAudits } from "@/components/admin/admin-audits";

const AdminAuditsPage = () => {
  return <AdminAudits />;
};

export default AdminAuditsPage;
`;
