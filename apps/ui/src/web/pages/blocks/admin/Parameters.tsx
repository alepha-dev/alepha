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
    description="Runtime configuration, versioned."
  >
    <Specimen title="AdminParameters">
      <AdminParameters />
    </Specimen>
  </BlockPage>
);

export default Parameters;
