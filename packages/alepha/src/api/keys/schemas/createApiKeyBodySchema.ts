import { z } from "alepha";

export const createApiKeyBodySchema = z.object({
  name: z.text({ minLength: 1, maxLength: 100 }),
  description: z.text({ maxLength: 500 }).optional(),
  expiresAt: z.datetime().optional(),
});
