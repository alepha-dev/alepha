import { AdminFiles } from "@alepha/ui/components/admin/admin-files";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The real `AdminFiles`, rendered outside `AdminRouter` - its layout carries
 * `permission: "admin:ui"` and this site has no realm to grant it.
 *
 * No knobs: the component takes no props and reads everything through
 * `useClient`. The viewport control in the header is still the point, since a
 * dense admin table is where a narrow screen bites first.
 */
const Files = () => (
  <Showcase title="Admin: files" description="Stored files across buckets.">
    {() => <AdminFiles />}
  </Showcase>
);

export default Files;
