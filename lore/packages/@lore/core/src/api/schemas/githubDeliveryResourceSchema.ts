import { type Infer } from "alepha";

import { githubDeliveries } from "../entities/githubDeliveries.ts";

/**
 * One delivery as Admin > GitHub lists it (#Q4364): event, repository,
 * outcome and attempts, never the body.
 */
export const githubDeliveryResourceSchema = githubDeliveries.schema.omit({
  payload: true,
});

export type GitHubDeliveryResource = Infer<typeof githubDeliveryResourceSchema>;
