import { type Infer, z } from "alepha";

/**
 * What the account page needs to render the two-factor section.
 */
export const myMfaStatusSchema = z
  .object({
    totp: z.object({
      enabled: z.boolean(),
      pending: z
        .boolean()
        .describe(
          "An enrollment was started but never confirmed with a code. It gates nothing.",
        ),
      recoveryCodesLeft: z.integer(),
    }),
  })
  .meta({ title: "MyMfaStatus" });

export type MyMfaStatus = Infer<typeof myMfaStatusSchema>;
