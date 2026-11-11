import { type Infer, z } from "alepha";

import { secondFactorMethodSchema } from "./secondFactorMethodSchema.ts";

/**
 * What a second-factor challenge tells the client: the `data` of a
 * `MfaRequiredError`.
 */
export const mfaChallengeSchema = z.object({
  challenge: z.text({
    size: "rich",
    description:
      "Opaque, signed, short-lived proof that the primary credential " +
      "passed. It grants nothing on its own.",
  }),
  methods: z
    .array(secondFactorMethodSchema)
    .describe("Which factors will clear it."),
  passkey: z
    .boolean()
    .describe(
      "Whether a passkey may clear this step: the realm offers passkeys " +
        "and this user holds a usable one. Computed after the password, so " +
        "it reveals nothing to someone who does not hold it. A passkey only " +
        "ever clears a step TOTP or an email code raised: `methods` is never " +
        "empty.",
    ),
  sentTo: z
    .text({
      description:
        "Masked destination, for a factor whose code was sent somewhere.",
    })
    .optional(),
});

export type MfaChallenge = Infer<typeof mfaChallengeSchema>;
