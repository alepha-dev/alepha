import { type Infer, z } from "alepha";

import { automationSafeFieldsSchema } from "./automationSafeFieldsSchema.ts";

export const automationEventPayloadSchema = z
  .object({
    fields: automationSafeFieldsSchema,
    omitted: z.array(z.string().max(128)).max(64),
  })
  .strict()
  .refine(
    (value) =>
      new TextEncoder().encode(JSON.stringify(value)).byteLength <= 65_536,
    { message: "Event payload exceeds 64 KiB" },
  );

export type AutomationEventPayload = Infer<typeof automationEventPayloadSchema>;
