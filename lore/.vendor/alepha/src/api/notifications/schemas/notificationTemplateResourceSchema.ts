import { type Infer, z } from "alepha";

/**
 * A registered `$notification`, as the admin filter bar sees it.
 *
 * ⚠️ Deliberately WITHOUT the template's variable schema. That is what a
 * create-from-template form needs, and publishing every template's variable
 * names to anyone holding `admin:notification:read` is not something a
 * filter dropdown should pay for. Add it when create lands, on its own
 * endpoint or behind its own permission.
 */
export const notificationTemplateResourceSchema = z.object({
  name: z.text({ maxLength: 100 }),
  category: z.text({ maxLength: 100 }).optional(),
  /**
   * Explicitly 1024, not a bare `z.text()`: that caps at 255, and a template
   * description is prose an app author writes freely. Over the cap, `$action`
   * rejects the whole RESPONSE rather than truncating one field, so a single
   * long description would empty the filter dropdowns.
   */
  description: z.text({ maxLength: 1024 }).optional(),
  /**
   * The channels this template declares, so the UI can say which of them a
   * given template can even produce.
   */
  channels: z.array(z.text({ maxLength: 32 })),
  critical: z.boolean(),
  sensitive: z.boolean(),
});

export type NotificationTemplateResource = Infer<
  typeof notificationTemplateResourceSchema
>;
