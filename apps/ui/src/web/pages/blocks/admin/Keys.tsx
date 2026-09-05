import { AdminKeys } from "@alepha/ui/components/admin/admin-keys";

import { BlockPage } from "@/web/components/BlockPage.tsx";
import { Specimen } from "@/web/components/Specimen.tsx";

/**
 * Creating a key here really does open the reveal dialog, because the fixture
 * answers with the same shape the real endpoint does. The token in it is
 * visibly fake on purpose: the point is the one-time reveal, not a credential.
 */
const Keys = () => (
  <BlockPage
    title="Admin: API keys"
    source="@alepha/ui/components/admin/admin-keys"
    description="Programmatic access tokens, shown by prefix and suffix because the key itself is displayed exactly once, at creation. One row is revoked and one expires, so both states are visible."
  >
    <Specimen
      title="AdminKeys"
      description="Holds two clients: the admin one lists and revokes, the user-facing one mints. Creating a key opens the reveal dialog with a deliberately fake token."
    >
      <AdminKeys />
    </Specimen>
  </BlockPage>
);

export default Keys;
