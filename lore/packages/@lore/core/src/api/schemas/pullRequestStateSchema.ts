import { type Infer, z } from "alepha";

import { pullRequests } from "../entities/pullRequests.ts";

/**
 * A pull request's state as a page, MCP or the CLI shows it beside its
 * record (#Q4367): from Lore's own row, kept from GitHub's deliveries.
 * `url` is the record's, as it was asked for.
 */
export const pullRequestStateSchema = pullRequests.schema
  .pick({
    number: true,
    title: true,
    state: true,
    checks: true,
    review: true,
    queued: true,
    headRef: true,
    baseRef: true,
    authorLogin: true,
    mergeableState: true,
    failingChecks: true,
    mergedAt: true,
    trustedAt: true,
    authorPermission: true,
  })
  .extend({
    url: z.string(),
    /**
     * From outside the team (#Q4368): an author without write, maintain or
     * admin on the repository, whom no member trusted yet.
     */
    outside: z.boolean(),
  });

export type PullRequestState = Infer<typeof pullRequestStateSchema>;
