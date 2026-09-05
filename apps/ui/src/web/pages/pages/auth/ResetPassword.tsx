import { AuthResetPassword } from "@alepha/ui/components/auth/auth-reset-password";
import { z } from "alepha";

import { Showcase } from "@/web/components/Showcase.tsx";
import { SHOWCASE_REALM } from "@/web/pages/blocks/showcaseRealm.ts";

/**
 * Password reset, which is a three-step flow inside one component: ask for the
 * address, enter the code that arrives, choose the new password.
 *
 * Only the first step renders here. The component holds the step in its own
 * state and advances it on a real API answer, and there is no realm behind this
 * site to send a code, so the later steps have no honest fixture. Their shape
 * is `RealmConfig.settings` and the password rules it carries, both visible in
 * the first step already.
 */
const KNOBS = z.object({
  loginLink: z.boolean().default(true).meta({ title: "Sign-in link" }),
});

const ResetPassword = () => (
  <Showcase
    id="pages/auth/ResetPassword"
    title="Reset password"
    description="AuthResetPassword, at its first step."
    schema={KNOBS}
    initialValues={{ loginLink: true }}
  >
    {(v) => (
      <div className="w-full">
        <AuthResetPassword
          realmConfig={SHOWCASE_REALM}
          loginPath={v.loginLink ? "/pages/auth/login" : undefined}
        />
      </div>
    )}
  </Showcase>
);

export default ResetPassword;
