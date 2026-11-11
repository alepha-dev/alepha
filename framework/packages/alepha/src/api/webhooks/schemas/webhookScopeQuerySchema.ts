import { type Infer, z } from "alepha";

/**
 * The tenancy scope an operation is limited to. Given, a row of another
 * scope (or of none) is not found.
 */
export const webhookScopeQuerySchema = z.object({
  scope: z.text({ maxLength: 255 }).optional(),
});

export type WebhookScopeQuery = Infer<typeof webhookScopeQuerySchema>;
