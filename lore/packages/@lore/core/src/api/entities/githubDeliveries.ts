import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * The states a stored delivery moves through (#Q4364).
 */
export const GITHUB_DELIVERY_STATUSES = [
  "pending",
  // Claimed by one run, since `handledAt` (the claim's time): another run
  // leaves it alone until the sweep's grace is past.
  "handling",
  "handled",
  "failed",
  "dropped",
] as const;

/**
 * One delivery of the instance's GitHub App, stored before it is answered
 * (#Q4364, epic #E177).
 *
 * The insert of GitHub's delivery GUID is the dedupe: a GUID already here is
 * acknowledged and not handled again. GitHub's redelivery carries the same
 * GUID, and a GUID is written only once the row is durably stored, so a
 * delivery Lore answered with an error was never stored and is taken when it
 * comes back. `payload` is kept only until the delivery is handled or
 * dropped; rows are kept seven days (GitHub lists deliveries for three).
 *
 * `projectId` is the project the repository resolved to, with no foreign
 * key: a delivery is a log line, and outlives nothing.
 */
export const githubDeliveries = $entity({
  name: "github_deliveries",
  schema: z.object({
    /**
     * `X-GitHub-Delivery`.
     */
    id: db.primaryKey(z.string().min(1).max(64)),
    event: z.string().min(1).max(64),
    action: z.string().max(64).optional(),
    installationId: z.integer().optional(),
    repositoryId: z.integer().optional(),
    repository: z.string().max(201).optional(),
    projectId: z.integer().optional(),
    status: z.enum(GITHUB_DELIVERY_STATUSES).meta({ mode: "text" }),
    attempts: z.integer(),
    lastError: z.string().max(500).optional(),
    payload: z.string().max(1_048_576).optional(),
    receivedAt: z.string(),
    handledAt: z.string().optional(),
  }),
  indexes: [{ columns: ["status", "receivedAt"] }, { columns: ["receivedAt"] }],
});

export type GitHubDelivery = Infer<typeof githubDeliveries.schema>;
