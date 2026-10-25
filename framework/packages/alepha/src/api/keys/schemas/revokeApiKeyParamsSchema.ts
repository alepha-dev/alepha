import { z } from "alepha";

export const revokeApiKeyParamsSchema = z.object({
  id: z.uuid(),
});
