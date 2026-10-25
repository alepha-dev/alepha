import { type Infer, z } from "alepha";

/**
 * Serve an earlier bundle to the whole cohort, whatever its version.
 */
export const otaRollbackSchema = z.object({
  bundleId: z.uuid(),
});

export type OtaRollback = Infer<typeof otaRollbackSchema>;
