import { z } from "alepha";

export const rotateApiKeyParamsSchema = z.object({
  id: z.uuid(),
});
