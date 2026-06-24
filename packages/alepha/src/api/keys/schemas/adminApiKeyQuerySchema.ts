import { z } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const adminApiKeyQuerySchema = pageQuerySchema.extend({
  userId: z.uuid().optional(),
  includeRevoked: z.boolean().optional(),
});
