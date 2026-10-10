import { type Infer, z } from "alepha";

/**
 * Why a kill switch was pulled, kept on the bundle.
 */
export const otaKillSchema = z.object({
  reason: z.text().optional(),
});

export type OtaKill = Infer<typeof otaKillSchema>;
