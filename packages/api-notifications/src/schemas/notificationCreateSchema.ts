import { type Static, t } from "@alepha/core";
import { notifications } from "../entities/notifications.ts";

export const notificationCreateSchema = t.pick(notifications.$schema, [
  "type",
  "contact",
  "template",
  "variables",
]);

export type NotificationCreate = Static<typeof notificationCreateSchema>;
