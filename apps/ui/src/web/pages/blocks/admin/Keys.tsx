import { AdminKeys } from "@alepha/ui/components/admin/admin-keys";

import { BlockPage } from "@/web/components/BlockPage.tsx";
import { Specimen } from "@/web/components/Specimen.tsx";

/**
 * Creating a key here really does open the reveal dialog, because the fixture
 * answers with the same shape the real endpoint does. The token in it is
 * visibly fake on purpose: the point is the one-time reveal, not a credential.
 */
const Keys = () => (
  <BlockPage title="Admin: API keys" description="Programmatic access tokens.">
    <Specimen title="AdminKeys">
      <AdminKeys />
    </Specimen>
  </BlockPage>
);

export default Keys;
