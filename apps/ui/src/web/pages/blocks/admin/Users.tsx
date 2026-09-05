import { AdminUsers } from "@alepha/ui/components/admin/admin-users";

import { BlockPage } from "@/web/components/BlockPage.tsx";
import { Specimen } from "@/web/components/Specimen.tsx";

/**
 * The real `AdminUsers`, rendered outside `AdminRouter`.
 *
 * `defaultHiddenColumns` is passed to show the prop doing its job rather than
 * because anything here is missing: every column has data, so hiding two makes
 * the column picker worth opening.
 */
const Users = () => (
  <BlockPage
    title="Admin: users"
    source="@alepha/ui/components/admin/admin-users"
    description="The user directory: server-paged, searchable, filterable by status, with an inline roles picker and bulk actions. Every mutation here is accepted and discarded, because the site is one shared page."
  >
    <Specimen
      title="AdminUsers"
      description="Roles come from findRoles and are editable inline. Use the column picker to bring back the two columns hidden by defaultHiddenColumns."
    >
      <AdminUsers defaultHiddenColumns={["firstName", "lastName"]} />
    </Specimen>
  </BlockPage>
);

export default Users;
