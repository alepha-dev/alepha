import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * A redelivery Lore asked GitHub for (#Q4364): once per GUID, so the next
 * hourly pass does not ask again. A separate table from the deliveries, so
 * asking never stores the GUID the redelivery itself will carry.
 */
export const githubRedeliveries = $entity({
  name: "github_redeliveries",
  schema: z.object({
    /**
     * The delivery's GUID.
     */
    id: db.primaryKey(z.string().min(1).max(64)),
    hookDeliveryId: z.integer(),
    askedAt: z.string(),
  }),
  indexes: [{ columns: ["askedAt"] }],
});

export type GitHubRedelivery = Infer<typeof githubRedeliveries.schema>;
