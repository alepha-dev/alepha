import { AdminAudits } from "@alepha/ui/components/admin/admin-audits";

import { BlockPage } from "@/web/components/BlockPage.tsx";
import { Specimen } from "@/web/components/Specimen.tsx";

/**
 * The real `AdminAudits`, rendered outside `AdminRouter`.
 *
 * The component is mounted directly rather than through the admin router
 * because that router's layout carries `permission: "admin:ui"`, and this site
 * has no realm to grant it. Mounting the component instead needs nothing:
 * `AdminAudits` takes no props and reaches its data through `useClient`, which
 * `ShowcaseAuditsController` answers.
 */
const Audits = () => (
  <BlockPage title="Admin: audit log" description="The audit trail.">
    <Specimen title="AdminAudits">
      <AdminAudits />
    </Specimen>
  </BlockPage>
);

export default Audits;
