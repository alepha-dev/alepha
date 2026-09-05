import { AdminAnalytics } from "@alepha/ui/components/admin/admin-analytics";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The real `AdminAnalytics`, rendered outside `AdminRouter` - its layout carries
 * `permission: "admin:ui"` and this site has no realm to grant it.
 *
 * No knobs: the component takes no props and reads everything through
 * `useClient`. The viewport control in the header is still the point, since a
 * dense admin table is where a narrow screen bites first.
 */
const Analytics = () => (
  <Showcase
    title="Admin: analytics"
    description="An explorer over declared datasets."
  >
    {() => <AdminAnalytics />}
  </Showcase>
);

export default Analytics;
