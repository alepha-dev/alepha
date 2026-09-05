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
    source="@alepha/ui/components/admin/admin-jobs"
    description="Registered jobs with their schedule, priority and recent success and error counts. Selecting a job opens its execution history, where a failed run offers a retry and a running one a cancel."
  >
    <Specimen
      title="AdminJobs"
      description="Triggering a job, retrying and cancelling are all accepted and discarded here. The execution rows carry a `can` block, which is what decides whether a row shows retry or cancel."
    >
      <AdminJobs />
    </Specimen>
  </BlockPage>
);

export default Jobs;
