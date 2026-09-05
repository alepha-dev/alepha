import { AdminAudits } from "@alepha/ui/components/admin/admin-audits";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The real `AdminAudits`, rendered outside `AdminRouter` - its layout carries
 * `permission: "admin:ui"` and this site has no realm to grant it.
 *
 * No knobs: the component takes no props and reads everything through
 * `useClient`. The viewport control in the header is still the point, since a
 * dense admin table is where a narrow screen bites first.
 */
const Audits = () => (
  <Showcase
    id="pages/admin/Audits"
    title="Admin: audit log"
    description="The audit trail."
  >
    {() => <AdminAudits />}
  </Showcase>
);

export default Audits;
