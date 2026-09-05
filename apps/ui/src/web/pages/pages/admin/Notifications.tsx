import { AdminNotifications } from "@alepha/ui/components/admin/admin-notifications";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The real `AdminNotifications`, rendered outside `AdminRouter` - its layout carries
 * `permission: "admin:ui"` and this site has no realm to grant it.
 *
 * No knobs: the component takes no props and reads everything through
 * `useClient`. The viewport control in the header is still the point, since a
 * dense admin table is where a narrow screen bites first.
 */
const Notifications = () => (
  <Showcase
    id="pages/admin/Notifications"
    title="Admin: notifications"
    description="The delivery log."
  >
    {() => <AdminNotifications />}
  </Showcase>
);

export default Notifications;
