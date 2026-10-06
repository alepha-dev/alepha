import { type Infer, z } from "alepha";

/**
 * One switch at a time, or both. An omitted key is left alone, so two
 * controls on the same page cannot clobber each other.
 */
export const updateNotificationPreferenceBodySchema = z.object({
  emailEnabled: z.boolean().optional(),
  mutedCategories: z.array(z.text({ maxLength: 100 })).optional(),
});

export type UpdateNotificationPreferenceBody = Infer<
  typeof updateNotificationPreferenceBodySchema
>;
