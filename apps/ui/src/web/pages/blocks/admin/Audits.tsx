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
  <BlockPage
    title="Admin: audit log"
    source="@alepha/ui/components/admin/admin-audits"
    description="The audit trail as the admin surface shows it: server-paged, filterable by type, action and layer, with bulk selection. Every row here is a fixture, and deleting one is accepted and ignored."
  >
    <Specimen
      title="AdminAudits"
      description="Takes no props. It loads its filter's type:action pairs on mount, then pages the log through the same client any application would use."
    >
      <AdminAudits />
    </Specimen>
  </BlockPage>
);

export default Audits;
