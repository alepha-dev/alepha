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
  sentTo: z
    .text({
      description:
        "Masked destination, for a factor whose code was sent somewhere.",
    })
    .optional(),
});

export type MfaChallenge = Infer<typeof mfaChallengeSchema>;
