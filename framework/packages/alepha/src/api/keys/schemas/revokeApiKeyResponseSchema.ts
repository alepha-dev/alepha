import { z } from "alepha";

export const revokeApiKeyResponseSchema = z.object({
  ok: z.boolean(),
});
