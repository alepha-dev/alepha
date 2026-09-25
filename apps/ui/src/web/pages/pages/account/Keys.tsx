import { AccountKeys } from "@alepha/ui/account";
import { z } from "alepha";

import { Showcase } from "@/web/components/Showcase.tsx";
import { SHOWCASE_KEYS } from "@/web/pages/pages/account/accountFixtures.ts";

/**
 * Personal API keys, one in each state: live, scoped, expiring, expired (it
 * keeps Rotate) and revoked (it keeps nothing). The status filter starts on
 * the live ones; the dead two are one filter change away.
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
      <div className="flex h-[36rem] flex-col">
        <AccountKeys apiKeys={v.empty ? [] : SHOWCASE_KEYS} />
      </div>
    )}
  </Showcase>
);

export default Keys;
