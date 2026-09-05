import { AdminSessions } from "@alepha/ui/components/admin/admin-sessions";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The real `AdminSessions`, rendered outside `AdminRouter` - its layout carries
 * `permission: "admin:ui"` and this site has no realm to grant it.
 *
 * No knobs: the component takes no props and reads everything through
 * `useClient`. The viewport control in the header is still the point, since a
 * dense admin table is where a narrow screen bites first.
 */
const Sessions = () => (
  <Showcase title="Admin: sessions" description="Where people are signed in.">
    {() => <AdminSessions />}
  </Showcase>
);

export default Sessions;
