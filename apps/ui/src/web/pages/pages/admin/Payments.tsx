import { AdminPayments } from "@alepha/ui/components/admin/admin-payments";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The real `AdminPayments`, rendered outside `AdminRouter` - its layout carries
 * `permission: "admin:ui"` and this site has no realm to grant it.
 *
 * No knobs: the component takes no props and reads everything through
 * `useClient`. The viewport control in the header is still the point, since a
 * dense admin table is where a narrow screen bites first.
 */
const Payments = () => (
  <Showcase
    id="pages/admin/Payments"
    title="Admin: payments"
    description="Payment intents."
  >
    {() => <AdminPayments />}
  </Showcase>
);

export default Payments;
