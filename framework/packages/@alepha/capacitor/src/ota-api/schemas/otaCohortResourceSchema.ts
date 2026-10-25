import { type Infer, z } from "alepha";

/**
 * What a channel serves to one compatibility cohort, spelled out.
 */
export const otaCohortResourceSchema = z.object({
  key: z.text(),
  platform: z.text({ maxLength: 16 }),
  fingerprint: z.text({ maxLength: 128 }),
  active: z.uuid().optional(),
  fallback: z.uuid().optional(),
  rollout: z.integer(),
});

export type OtaCohortResource = Infer<typeof otaCohortResourceSchema>;
