import { type Infer, z } from "alepha";

/**
 * A one-time enrolment secret, shown once (#Q3165): what a provisioned
 * server's cloud-init hands `bay connector set`, which exchanges it for the
 * estate's long-lived secret over `POST /estates/enrol`.
 */
export const estateEnrolmentSchema = z.object({
  secret: z.string(),
  expiresAt: z.string(),
});

export type EstateEnrolment = Infer<typeof estateEnrolmentSchema>;
