import { AdminPayments } from "@alepha/ui/components/admin/admin-payments";

import { BlockPage } from "@/web/components/BlockPage.tsx";
import { Specimen } from "@/web/components/Specimen.tsx";

/**
 * Only the listing is fixtured. Capture, void, refund and record-cash exist on
 * the real controller and are deliberately absent here rather than stubbed: a
 * fixture that accepts a refund and silently does nothing is a worse lie than
 * elsewhere on this site, because money is the one thing a reader might believe
 * actually moved.
 */
const Payments = () => (
  <BlockPage title="Admin: payments" description="Payment intents.">
    <Specimen title="AdminPayments">
      <AdminPayments />
    </Specimen>
  </BlockPage>
);

export default Payments;
