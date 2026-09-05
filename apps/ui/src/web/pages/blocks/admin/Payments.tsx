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
  <BlockPage
    title="Admin: payments"
    source="@alepha/ui/components/admin/admin-payments"
    description="Payment intents with their amount, currency, status and payer. Amounts are stored in minor units, so 4250 is 42.50."
  >
    <Specimen
      title="AdminPayments"
      description="The statuses cover the settled-but-not-clean cases a happy-path dataset never shows: partially refunded, voided, cancelled and failed."
    >
      <AdminPayments />
    </Specimen>
  </BlockPage>
);

export default Payments;
