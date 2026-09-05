import { AdminJobs } from "@alepha/ui/components/admin/admin-jobs";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The real `AdminJobs`, rendered outside `AdminRouter` - its layout carries
 * `permission: "admin:ui"` and this site has no realm to grant it.
 *
 * No knobs: the component takes no props and reads everything through
 * `useClient`. The viewport control in the header is still the point, since a
 * dense admin table is where a narrow screen bites first.
 */
const Jobs = () => (
  <Showcase
    id="pages/admin/Jobs"
    title="Admin: jobs"
    description="Registered jobs and their runs."
  >
    {() => <AdminJobs />}
  </Showcase>
);

export default Jobs;
