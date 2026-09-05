import AccountConnections from "@alepha/ui/components/account/account-connections";
import { z } from "alepha";

import { Showcase } from "@/web/components/Showcase.tsx";
import { SHOWCASE_CONNECTIONS } from "@/web/pages/pages/account/accountFixtures.ts";

/**
 * OAuth applications this account has authorised, and the scopes each was
 * granted. The screen exists so a person can withdraw one, so the empty state
 * is the one most accounts are actually in.
 */
const KNOBS = z.object({
  empty: z.boolean().default(false).meta({ title: "Empty" }),
});

const Connections = () => (
  <Showcase
    id="pages/account/Connections"
    title="Connections"
    description="Authorised applications and their scopes."
    schema={KNOBS}
    initialValues={{ empty: false }}
  >
    {(v) => (
      <div className="mx-auto max-w-3xl">
        <AccountConnections
          connections={(v.empty ? [] : SHOWCASE_CONNECTIONS) as never}
        />
      </div>
    )}
  </Showcase>
);

export default Connections;
