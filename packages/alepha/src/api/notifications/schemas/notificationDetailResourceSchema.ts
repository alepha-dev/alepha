import { type Static, t } from "alepha";
import { logEntrySchema } from "alepha/logger";
import { notificationResourceSchema } from "./notificationResourceSchema.ts";

export const notificationDetailResourceSchema = t.extend(
  notificationResourceSchema,
  {
    variables: t.optional(t.record(t.text(), t.any())),
    rendered: t.optional(t.record(t.text(), t.any())),
    logs: t.optional(t.array(logEntrySchema)),
  },
  {
    title: "NotificationDetailResource",
    description: "A notification resource with rendered content and logs.",
  },
);

export type NotificationDetailResource = Static<
  typeof notificationDetailResourceSchema
>;
