import { AdminKeys } from "@alepha/ui/components/admin/admin-keys";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The real `AdminKeys`, rendered outside `AdminRouter` - its layout carries
 * `permission: "admin:ui"` and this site has no realm to grant it.
 *
 * No knobs: the component takes no props and reads everything through
 * `useClient`. The viewport control in the header is still the point, since a
 * dense admin table is where a narrow screen bites first.
 */
const Keys = () => (
  <Showcase title="Admin: API keys" description="Programmatic access tokens.">
    {() => <AdminKeys />}
  </Showcase>
);

export default Keys;
