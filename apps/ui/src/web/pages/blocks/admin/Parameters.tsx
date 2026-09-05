import { AdminParameters } from "@alepha/ui/components/admin/admin-parameters";

import { BlockPage } from "@/web/components/BlockPage.tsx";
import { Specimen } from "@/web/components/Specimen.tsx";

/**
 * The tree, the values and the history all come from one list in the fixture.
 * `AdminParameters` navigates the tree and then asks for the leaf it landed
 * on, so a node with no matching value opens an empty panel and reports
 * nothing: deriving all three from one source is what prevents that.
 */
const Parameters = () => (
  <BlockPage
    title="Admin: parameters"
    source="@alepha/ui/components/admin/admin-parameters"
    description="Runtime configuration, versioned. Each setting keeps a history, so a change can be scheduled ahead of time and rolled back afterwards, and two versions can be diffed."
  >
    <Specimen
      title="AdminParameters"
      description="One branch is an orphan: rows exist and no $parameter declares the name any more, which a rename or a removal leaves behind. The tree renders that differently, and it is never deleted on its own."
    >
      <AdminParameters />
    </Specimen>
  </BlockPage>
);

export default Parameters;
