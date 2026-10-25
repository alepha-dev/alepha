import { type Infer, z } from "alepha";

/**
 * Choose the bundle a cohort falls back to, or none.
 */
export const otaFallbackSchema = z.object({
  cohort: z.text(),
  bundleId: z.uuid().optional(),
});

export type OtaFallback = Infer<typeof otaFallbackSchema>;
