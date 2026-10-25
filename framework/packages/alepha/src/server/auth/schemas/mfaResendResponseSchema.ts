import { type Infer, z } from "alepha";

export const mfaResendResponseSchema = z
  .object({
    sentTo: z
      .text()
      .describe(
        "Masked destination the code was sent to. Absent for factors that generate their code on the user's own device.",
      )
      .optional(),
  })
  .meta({ title: "MfaResendResponse" });

export type MfaResendResponse = Infer<typeof mfaResendResponseSchema>;
