import { z } from "alepha";
import { pageQuerySchema } from "alepha/orm";

import { apiKeyStatusSchema } from "./apiKeyStatusSchema.ts";

export const adminApiKeyQuerySchema = pageQuerySchema.extend({
  userId: z.uuid().optional(),
  /**
   * Keys in any of these statuses, derived by the same rule as each row's
   * `status` (`ApiKeyService.statusWhere`). Omitted or empty, the listing
   * falls back to `includeRevoked`.
   */
  status: z.array(apiKeyStatusSchema).optional(),
  /**
   * @deprecated Use `status`. Kept working: without `status`, revoked keys are
   * hidden unless this is `true`, as before. Ignored whenever `status` is set.
   */
  includeRevoked: z.boolean().optional(),
});
