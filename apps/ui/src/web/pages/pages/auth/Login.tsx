import { AuthLogin } from "@alepha/ui/components/auth/auth-login";
import { z } from "alepha";

import { Showcase } from "@/web/components/Showcase.tsx";
import { SHOWCASE_REALM } from "@/web/pages/blocks/showcaseRealm.ts";

/**
 * The sign-in screen, against a fixture realm.
 *
 * It takes its realm as a PROP rather than fetching it, which is what lets the
 * whole surface render on a site with no users table. The realm decides which
 * providers appear, so the OAuth row below is the fixture's, not a mock.
 */
const KNOBS = z.object({
  variant: z
    .enum(["centered", "split"])
    .default("centered")
    .meta({ title: "variant" }),
  registerLink: z.boolean().default(true).meta({ title: "Sign-up link" }),
  resetLink: z.boolean().default(true).meta({ title: "Forgot link" }),
  overlay: z.boolean().default(false).meta({ title: "Split overlay" }),
});

const Login = () => (
  <Showcase
    id="pages/auth/Login"
    title="Sign in"
    description="AuthLogin, centred or split."
    schema={KNOBS}
    initialValues={{
      variant: "centered",
      registerLink: true,
      resetLink: true,
      overlay: false,
    }}
  >
    {(v) => (
      <div className="w-full">
        <AuthLogin
          realmConfig={SHOWCASE_REALM}
          variant={v.variant}
          registerPath={v.registerLink ? "/pages/auth/register" : undefined}
          resetPasswordPath={v.resetLink ? "/pages/auth/reset" : undefined}
          background={
            v.overlay
              ? {
                  overlay: (
                    <div className="space-y-2 text-balance">
                      <p className="text-2xl font-semibold">Alepha</p>
                      <p className="text-sm opacity-80">
                        End-to-end type safety, by convention.
                      </p>
                    </div>
                  ),
                }
              : undefined
          }
        />
      </div>
    )}
  </Showcase>
);

export default Login;
