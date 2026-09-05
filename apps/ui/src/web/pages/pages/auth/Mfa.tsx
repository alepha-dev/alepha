import { AuthMfaStep } from "@alepha/ui/components/auth/auth-mfa-step";
import { z } from "alepha";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The second step of a sign-in, which `AuthLogin` swaps in for the credentials
 * form when the server answers that a factor is owed.
 *
 * It is its own page here because it is unreachable otherwise: getting to it
 * through the login screen needs a real account with a real factor enrolled,
 * and this site has neither. The challenge below is a literal of the same shape
 * the server sends.
 *
 * The same component serves both factors - only the wording and the resend
 * affordance differ - so the knob is which methods the challenge names.
 */
const KNOBS = z.object({
  method: z
    .enum(["emailCode", "totp"])
    .default("emailCode")
    .meta({ title: "Factor" }),
  sentTo: z.string().default("a•••@alepha.dev").meta({ title: "Address" }),
});

const Mfa = () => (
  <Showcase
    id="pages/auth/Mfa"
    title="Second factor"
    description="AuthMfaStep, for a code sent or generated."
    schema={KNOBS}
    initialValues={{ method: "emailCode", sentTo: "a•••@alepha.dev" }}
    center
  >
    {(v) => (
      <AuthMfaStep
        // Remounted per factor: the component seeds its own `sentTo` state from
        // the challenge, so changing the prop alone leaves the old wording.
        key={`${v.method}-${v.sentTo}`}
        challenge={{
          challenge: "showcase-challenge",
          methods: [v.method],
          sentTo: v.method === "emailCode" ? v.sentTo : undefined,
        }}
        onVerified={() => {}}
        onCancel={() => {}}
      />
    )}
  </Showcase>
);

export default Mfa;
