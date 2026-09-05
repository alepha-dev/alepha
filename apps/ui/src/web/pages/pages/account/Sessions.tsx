import AccountSessions from "@alepha/ui/components/account/account-sessions";
import { z } from "alepha";

import { Showcase } from "@/web/components/Showcase.tsx";
import { SHOWCASE_SESSIONS } from "@/web/pages/pages/account/accountFixtures.ts";

/**
 * Where the account is signed in. The fixture carries one current session and
 * one not, because `current` is the distinction the component draws and the
 * reason it refuses to revoke that row.
 */
const KNOBS = z.object({
  empty: z.boolean().default(false).meta({ title: "Empty" }),
});

const Sessions = () => (
  <Showcase
    id="pages/account/Sessions"
    title="Sessions"
    description="Every device this account is signed in on."
    schema={KNOBS}
    initialValues={{ empty: false }}
  >
    {(v) => (
      <div className="mx-auto max-w-3xl">
        <AccountSessions
          sessions={(v.empty ? [] : SHOWCASE_SESSIONS) as never}
        />
      </div>
    )}
  </Showcase>
);

export default Sessions;
