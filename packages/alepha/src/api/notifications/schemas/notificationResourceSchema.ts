import { type Static, t } from "alepha";

export const notificationResourceSchema = t.object({
  id: t.uuid(),
  createdAt: t.datetime(),
  status: t.text(),
  template: t.optional(t.text()),
  type: t.optional(t.text()),
  contact: t.optional(t.text()),
  category: t.optional(t.text()),
  critical: t.optional(t.boolean()),
  sensitive: t.optional(t.boolean()),
  startedAt: t.optional(t.datetime()),
  completedAt: t.optional(t.datetime()),
  error: t.optional(t.text()),
});

export type NotificationResource = Static<typeof notificationResourceSchema>;
