import { type Infer, z } from "alepha";

/**
 * One event of the catalog: its name, what it means, and the JSON Schema of
 * its `data`, derived from its `$webhook` declaration.
 */
export const webhookEventResourceSchema = z.object({
  name: z.text({ maxLength: 100 }),
  description: z.text({ maxLength: 1000 }),
  schema: z.record(z.text(), z.any()),
});

export type WebhookEventResource = Infer<typeof webhookEventResourceSchema>;
