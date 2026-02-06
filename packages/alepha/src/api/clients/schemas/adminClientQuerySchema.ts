import { t } from "alepha";
import { pageQuerySchema } from "alepha/orm";

/**
 * Query schema for admin client listing.
 */
export const adminClientQuerySchema = t.extend(pageQuerySchema, {
  enabled: t.optional(t.boolean()),
  firstParty: t.optional(t.boolean()),
});
