import { AuthRegister } from "@alepha/ui/components/auth/auth-register";
import { z } from "alepha";

import { Showcase } from "@/web/components/Showcase.tsx";
import { SHOWCASE_REALM } from "@/web/pages/blocks/showcaseRealm.ts";

/**
 * Registration. Which fields are required, and whether a verification step
 * follows, are the realm's decision rather than a prop, so the fixture realm
 * is what shapes this form.
 */
const KNOBS = z.object({
  loginLink: z.boolean().default(true).meta({ title: "Sign-in link" }),
  message: z.string().default("").meta({ title: "Banner" }).optional(),
});

const Register = () => (
  <Showcase
    id="pages/auth/Register"
    title="Register"
    description="AuthRegister, driven by the realm's required fields."
    schema={KNOBS}
    initialValues={{ loginLink: true, message: "" }}
  >
    {(v) => (
      <div className="w-full">
        <AuthRegister
          realmConfig={SHOWCASE_REALM}
          loginPath={v.loginLink ? "/pages/auth/login" : undefined}
          message={v.message || undefined}
        />
      </div>
    )}
  </Showcase>
);

export default Register;
