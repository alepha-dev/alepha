import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projects } from "./projects.ts";
import { users } from "./users.ts";

export const PULL_REQUEST_STATES = [
  "open",
  "draft",
  "merged",
  "closed",
] as const;

export const PULL_REQUEST_CHECKS = [
  "none",
  "pending",
  "passing",
  "failing",
] as const;

export const PULL_REQUEST_REVIEWS = [
  "none",
  "requested",
  "approved",
  "changes_requested",
] as const;

/**
 * A pull request Lore knows, of a connected project's repository (#Q4367,
 * epic #E177): GitHub's state, kept from its deliveries, never read from
 * GitHub when a page asks.
 *
 * Core's table, though Plan attaches pull requests to quests: the agent job
 * page (Prompts, #Q4369) and the events (Plan, #Q4368) both read it, and
 * neither package may import the other. Written by `PullRequestStateService`
 * from `pull_request`, `pull_request_review`, `check_suite`, `check_run`,
 * `status` and `workflow_run` deliveries.
 *
 * The record on a quest or an epic (a JSON entry with a URL) is matched to
 * its row on read, by repository and number; no column is added to quests.
 *
 * ⚠️ Every text here came from GitHub: title, branches, logins and check
 * names are data, capped when written and escaped where shown.
 */
export const pullRequests = $entity({
  name: "pull_requests",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    repositoryId: z.integer(),
    /**
     * `owner/name` when the row was last written: a record made before a
     * rename still finds its row through the connection's former names.
     */
    repository: z.string().max(201),
    /**
     * GitHub's own id of the pull request.
     */
    githubId: z.integer(),
    number: z.integer(),
    title: z.string().max(500),
    url: z.string().max(500),
    authorLogin: z.string().max(100).optional(),
    authorGithubId: z.integer().optional(),
    /**
     * The author's permission on the repository, read once when the pull
     * request is first seen (#Q4368): `admin`, `maintain`, `write`, ...
     */
    authorPermission: z.string().max(20).optional(),
    /**
     * A member's trust of a pull request from outside the team (#Q4368).
     */
    trustedBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    trustedAt: z.string().optional(),
    headRef: z.string().max(255),
    baseRef: z.string().max(255),
    headSha: z.string().max(64),
    state: z.enum(PULL_REQUEST_STATES).meta({ mode: "text" }),
    /**
     * In GitHub's merge queue (`enqueued`, until `dequeued`).
     */
    queued: z.boolean().optional(),
    checks: z.enum(PULL_REQUEST_CHECKS).meta({ mode: "text" }),
    review: z.enum(PULL_REQUEST_REVIEWS).meta({ mode: "text" }),
    /**
     * `behind`, `dirty` (in conflict), `clean`, ... as the last delivery
     * said; GitHub often sends `unknown`, which is not kept.
     */
    mergeableState: z.string().max(20).optional(),
    /**
     * The current head's check suites (`id -> status:conclusion`) and the
     * latest commit status per context (`context -> state`), from which the
     * rollup is computed. Reset on a new head sha.
     */
    suites: z.record(z.string(), z.string().max(64)).optional(),
    statuses: z.record(z.string(), z.string().max(20)).optional(),
    /**
     * The current head's failing check runs, at most twenty, for the job
     * page (#Q4369): nothing calls GitHub on read.
     */
    failingChecks: z
      .array(
        z.object({
          id: z.integer(),
          name: z.string().max(200),
          url: z.string().max(500).optional(),
        }),
      )
      .max(20)
      .optional(),
    mergedAt: z.string().optional(),
    closedAt: z.string().optional(),
    githubUpdatedAt: z.string().optional(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
  }),
  indexes: [
    { columns: ["repositoryId", "number"], unique: true },
    { columns: ["projectId", "state"] },
    { columns: ["projectId", "headRef"] },
  ],
});

export type PullRequestRow = Infer<typeof pullRequests.schema>;
