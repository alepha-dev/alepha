import { z } from "alepha";

export const createApiKeyResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  token: z.string(),
  tokenSuffix: z.string(),
  roles: z.array(z.string()),
  createdAt: z.datetime(),
  expiresAt: z.datetime().optional(),
});
