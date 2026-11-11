import { AdminWebhooks } from "@alepha/ui/admin";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The real `AdminWebhooks`, rendered outside `AdminRouter` - its layout
 * carries `permission: "admin:ui"` and this site has no realm to grant it.
 *
 * The data is three fixture endpoints, one per status. The writes (create,
 * pause, rotate) are not wired: the showcase answers no write.
 */
const Webhooks = () => (
  <Showcase
    id="pages/admin/Webhooks"
    title="Admin: webhooks"
    description="Webhook endpoints and their health."
  >
    {() => <AdminWebhooks />}
  </Showcase>
);

export default Webhooks;
