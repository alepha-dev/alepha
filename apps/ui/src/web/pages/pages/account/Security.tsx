import AccountSecurity from "@alepha/ui/components/account/account-security";
import { z } from "alepha";

import { Showcase } from "@/web/components/Showcase.tsx";
import { SHOWCASE_REALM } from "@/web/pages/blocks/showcaseRealm.ts";
import { SHOWCASE_IDENTITIES } from "@/web/pages/pages/account/accountFixtures.ts";

/**
 * Password, second factor, linked providers and deletion.
 *
 * It does call `useAuth()`, but only to log out after the account is deleted -
 * nothing it RENDERS comes from the session, so it draws correctly here.
 *
 * `realmConfig` carries `settings.mfa`, which decides whether the two-factor
 * row is offered at all. Absent, the row renders: hiding a factor a realm does
 * want is the worse failure, since the server refuses the enrollment either
 * way. The knob shows both.
 */
const KNOBS = z.object({
  realm: z.boolean().default(true).meta({ title: "realmConfig" }),
  identities: z.boolean().default(true).meta({ title: "Linked providers" }),
  warning: z.string().default("").meta({ title: "Warning" }).optional(),
});

const Security = () => (
  <Showcase
    id="pages/account/Security"
    title="Security"
    description="Password, second factor, linked providers, deletion."
    schema={KNOBS}
    initialValues={{ realm: true, identities: true, warning: "" }}
  >
    {(v) => (
      <div className="mx-auto max-w-3xl">
        <AccountSecurity
          realmConfig={v.realm ? SHOWCASE_REALM : undefined}
          identities={(v.identities ? SHOWCASE_IDENTITIES : undefined) as never}
          deleteWarning={v.warning || undefined}
        />
      </div>
    )}
  </Showcase>
);

export default Security;
