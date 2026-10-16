import { type Infer, z } from "alepha";

export const automationAudiencePreviewSchema = z
  .object({
    recipients: z
      .array(z.object({ value: z.uuid(), label: z.string().max(255) }).strict())
      .max(50),
    total: z.integer().nonnegative(),
    hasMore: z.boolean(),
    excludesPublisher: z.literal(true),
  })
  .strict();
export type AutomationAudiencePreview = Infer<
  typeof automationAudiencePreviewSchema
>;
