import { AdminAnalytics } from "@alepha/ui/components/admin/admin-analytics";

import { BlockPage } from "@/web/components/BlockPage.tsx";
import { Specimen } from "@/web/components/Specimen.tsx";

/**
 * The only fixture on this site that computes its answer from the request.
 *
 * The explorer lets a reader change the grouping, the window and the measures,
 * so a canned result would answer every question with the same table and make
 * the controls look inert. The numbers are still deterministic, so the page
 * prerenders identically on every build.
 */
const Analytics = () => (
  <BlockPage
    title="Admin: analytics"
    source="@alepha/ui/components/admin/admin-analytics"
    description="An explorer over declared datasets: pick dimensions to group by, measures to sum, and a window. The dataset's dimensions and measures arrive as JSON Schema and the form is rebuilt from them."
  >
    <Specimen
      title="AdminAnalytics"
      description="Change the grouping and the table changes with it. The result also carries whether it was estimated and at what sampling interval, which the UI is free to surface or ignore, visibly."
    >
      <AdminAnalytics />
    </Specimen>
  </BlockPage>
);

export default Analytics;
