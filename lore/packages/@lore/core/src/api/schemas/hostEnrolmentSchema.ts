import { type Infer, z } from "alepha";

/**
 * A one-time enrolment secret, shown once (#Q3165): what a provisioned
 * server's cloud-init hands `bay connector set`, which exchanges it for the
 * host's long-lived secret over `POST /estates/enrol`.
 */
export const hostEnrolmentSchema = z.object({
  secret: z.string(),
  expiresAt: z.string(),
});

export type HostEnrolment = Infer<typeof hostEnrolmentSchema>;
