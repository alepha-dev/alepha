import { AccountKeys } from "@alepha/ui/account";
import { z } from "alepha";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * Personal API keys, one in each state: live, scoped, expiring, expired (it
 * keeps Rotate) and revoked (it keeps nothing). The status filter starts on
 * the live ones; the dead two are one filter change away.
 */
const KNOBS = z.object({});

const Keys = () => (
  <Showcase
    id="pages/account/Keys"
    title="API keys"
    description="Personal tokens, live and revoked."
    schema={KNOBS}
    initialValues={{}}
  >
    {() => (
      <div className="flex h-[36rem] flex-col">
        <AccountKeys />
      </div>
    )}
  </Showcase>
);

export default Keys;
