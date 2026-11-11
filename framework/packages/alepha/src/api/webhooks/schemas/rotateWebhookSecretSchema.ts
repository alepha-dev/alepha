import { type Infer, z } from "alepha";

/**
 * A secret rotation: `expireNow` drops the old secret at once instead of
 * letting it sign for 24 more hours, for a leak.
 */
export const rotateWebhookSecretSchema = z.object({
  expireNow: z.boolean().optional(),
});

export type RotateWebhookSecret = Infer<typeof rotateWebhookSecretSchema>;
