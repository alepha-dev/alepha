import { AuthVerifyEmail } from "@alepha/ui/components/auth/auth-verify-email";
import { z } from "alepha";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The screen a verification link lands on.
 *
 * `step` is a real prop, documented on the component as being for exactly this:
 * pinning one of the three outcomes instead of waiting for a token that does
 * not exist here. All three are one knob away.
 */
const KNOBS = z.object({
  step: z
    .enum(["verifying", "success", "error"])
    .default("success")
    .meta({ title: "step" }),
  loginLink: z.boolean().default(true).meta({ title: "Sign-in link" }),
});

const VerifyEmail = () => (
  <Showcase
    id="pages/auth/VerifyEmail"
    title="Verify email"
    description="AuthVerifyEmail, in each of its three outcomes."
    schema={KNOBS}
    initialValues={{ step: "success", loginLink: true }}
    center
  >
    {(v) => (
      <div className="w-full">
        <AuthVerifyEmail
          step={v.step}
          loginPath={v.loginLink ? "/pages/auth/login" : undefined}
        />
      </div>
    )}
  </Showcase>
);

export default VerifyEmail;
