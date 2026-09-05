import { AuthLogin } from "@alepha/ui/components/auth/auth-login";
import { AuthRegister } from "@alepha/ui/components/auth/auth-register";
import { AuthResetPassword } from "@alepha/ui/components/auth/auth-reset-password";
import { AuthVerifyEmail } from "@alepha/ui/components/auth/auth-verify-email";
import { z } from "alepha";

import { Showcase } from "@/web/components/Showcase.tsx";
import { SHOWCASE_REALM } from "@/web/pages/blocks/showcaseRealm.ts";

/**
 * The auth screens, against a fixture realm.
 *
 * They take their realm as a PROP rather than fetching it, which is what lets
 * the whole surface render on a site with no users table.
 */
const KNOBS = z.object({
  screen: z
    .enum(["login", "register", "reset", "verify"])
    .default("login")
    .meta({ title: "Screen" }),
  variant: z
    .enum(["centered", "split"])
    .default("centered")
    .meta({ title: "variant (login)" }),
  registerLink: z.boolean().default(true).meta({ title: "Sign-up link" }),
  resetLink: z.boolean().default(true).meta({ title: "Forgot link" }),
});

const Auth = () => (
  <Showcase
    title="Auth"
    description="Sign in, register, reset and verify."
    schema={KNOBS}
    initialValues={{
      screen: "login",
      variant: "centered",
      registerLink: true,
      resetLink: true,
    }}
  >
    {(v) => (
      <div className="w-full">
        {v.screen === "login" ? (
          <AuthLogin
            realmConfig={SHOWCASE_REALM}
            variant={v.variant}
            registerPath={v.registerLink ? "/pages/auth" : undefined}
            resetPasswordPath={v.resetLink ? "/pages/auth" : undefined}
          />
        ) : null}
        {v.screen === "register" ? (
          <AuthRegister realmConfig={SHOWCASE_REALM} loginPath="/pages/auth" />
        ) : null}
        {v.screen === "reset" ? (
          <AuthResetPassword
            realmConfig={SHOWCASE_REALM}
            loginPath="/pages/auth"
          />
        ) : null}
        {v.screen === "verify" ? (
          <AuthVerifyEmail loginPath="/pages/auth" />
        ) : null}
      </div>
    )}
  </Showcase>
);

export default Auth;
