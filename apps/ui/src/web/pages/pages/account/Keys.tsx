import AccountKeys from "@alepha/ui/components/account/account-keys";
import { z } from "alepha";

import { Showcase } from "@/web/components/Showcase.tsx";
import { SHOWCASE_KEYS } from "@/web/pages/pages/account/accountFixtures.ts";

/**
 * Personal API keys. The fixture carries one live and one revoked, which is the
 * only pair that shows both states of the row: a revoked key keeps its usage
 * count and loses its actions.
 */
const KNOBS = z.object({
  empty: z.boolean().default(false).meta({ title: "Empty" }),
});

const Keys = () => (
  <Showcase
    id="pages/account/Keys"
    title="API keys"
    description="Personal tokens, live and revoked."
    schema={KNOBS}
    initialValues={{ empty: false }}
  >
    {(v) => (
      <div className="mx-auto max-w-3xl">
        <AccountKeys apiKeys={(v.empty ? [] : SHOWCASE_KEYS) as never} />
      </div>
    )}
  </Showcase>
);

export default Keys;
