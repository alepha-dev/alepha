import { type Infer, z } from "alepha";

export const notificationResourceSchema = z.object({
  id: z.uuid(),
  createdAt: z.datetime(),
  status: z.text(),
  template: z.text().optional(),
  type: z.text().optional(),
  contact: z.text().optional(),
  category: z.text().optional(),
  critical: z.boolean().optional(),
  sensitive: z.boolean().optional(),
  startedAt: z.datetime().optional(),
  completedAt: z.datetime().optional(),
  error: z.text().optional(),
});

export type NotificationResource = Infer<typeof notificationResourceSchema>;
