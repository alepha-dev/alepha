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
  <BlockPage
    title="Admin: notifications"
    source="@alepha/ui/components/admin/admin-notifications"
    description="The delivery log: what was sent, on which channel, to whom, and what the transport said about it. Opening a row shows the rendered message, or the reason there is none."
  >
    <Specimen
      title="AdminNotifications"
      description="A preview answers `available: false` with a reason as a normal 200, because a purged outbox row and a sensitive template are both states to draw rather than errors."
    >
      <AdminNotifications />
    </Specimen>
  </BlockPage>
);

export default Notifications;
