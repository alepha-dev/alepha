import { type Static, z } from "alepha";
import { logEntrySchema } from "alepha/logger";
import { notificationResourceSchema } from "./notificationResourceSchema.ts";

export const notificationDetailResourceSchema = notificationResourceSchema
  .extend({
    variables: z.record(z.text(), z.any()).optional(),
    rendered: z.record(z.text(), z.any()).optional(),
    logs: z.array(logEntrySchema).optional(),
  })
  .meta({
    title: "NotificationDetailResource",
    description: "A notification resource with rendered content and logs.",
  });

export type NotificationDetailResource = Static<
  typeof notificationDetailResourceSchema
>;
