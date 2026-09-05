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
  <BlockPage title="Admin: users" description="The user directory.">
    <Specimen title="AdminUsers">
      <AdminUsers defaultHiddenColumns={["firstName", "lastName"]} />
    </Specimen>
  </BlockPage>
);

export default Users;
