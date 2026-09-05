import { AdminParameters } from "@alepha/ui/components/admin/admin-parameters";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The real `AdminParameters`, rendered outside `AdminRouter` - its layout carries
 * `permission: "admin:ui"` and this site has no realm to grant it.
 *
 * No knobs: the component takes no props and reads everything through
 * `useClient`. The viewport control in the header is still the point, since a
 * dense admin table is where a narrow screen bites first.
 */
const Parameters = () => (
  <Showcase
    id="pages/admin/Parameters"
    title="Admin: parameters"
    description="Runtime configuration, versioned."
  >
    {() => <AdminParameters />}
  </Showcase>
);

export default Parameters;
