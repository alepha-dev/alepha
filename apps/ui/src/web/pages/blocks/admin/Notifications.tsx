import { AdminNotifications } from "@alepha/ui/components/admin/admin-notifications";

import { BlockPage } from "@/web/components/BlockPage.tsx";
import { Specimen } from "@/web/components/Specimen.tsx";

/**
 * The fixtures are chosen for the states the component draws differently, not
 * for realism: one row per delivery status, one `skipped` row so `skipReason`
 * is visible, one from a `sensitive` template (which stores no subject and can
 * never be previewed), and two whose outbox rows have aged out, which is what
 * disables Resend rather than offering an action that can only fail.
 */
const Notifications = () => (
  <BlockPage title="Admin: notifications" description="The delivery log.">
    <Specimen title="AdminNotifications">
      <AdminNotifications />
    </Specimen>
  </BlockPage>
);

export default Notifications;
