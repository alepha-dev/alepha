import { AdminJobs } from "@alepha/ui/components/admin/admin-jobs";

import { BlockPage } from "@/web/components/BlockPage.tsx";
import { Specimen } from "@/web/components/Specimen.tsx";

/**
 * The real `AdminJobs`, rendered outside `AdminRouter`.
 *
 * The fixtures cover all three job types (`cron`, `queue`, `direct`) and all
 * four priorities on purpose: the table renders a badge per type and per
 * priority, and a dataset of one shape would leave most of them unseen.
 */
const Jobs = () => (
  <BlockPage
    title="Admin: jobs"
    description="Registered jobs and their executions."
  >
    <Specimen title="AdminJobs">
      <AdminJobs />
    </Specimen>
  </BlockPage>
);

export default Jobs;
