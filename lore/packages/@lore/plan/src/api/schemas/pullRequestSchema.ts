import { type Infer, z } from "alepha";

/**
 * A pull request's URL as a caller sends it: http or https, no whitespace.
 *
 * A pattern rather than a refinement, so the JSON schema an MCP client reads
 * carries it, and so `javascript:` never reaches an `href` on the quest rail
 * or the epic page.
 */
export const PULL_REQUEST_URL_PATTERN = /^https?:\/\/\S+$/i;

/**
 * One pull request recorded against a quest or an epic (#Q3707).
 *
 * The record is what the agent writes, like a commit
 * (`questCommitSchema`): Lore never reads the pull request's state from the
 * forge, so there is no `open` or `merged` here and nothing to keep in step.
 *
 * `url` is the identity and the link target, both: the rail and the epic
 * page link the URL as recorded, where a sha is linked from the project's
 * repository URL (#Q4217). `number`, `repo` and `title` are what a reader
 * sees in its place, all optional because a bare URL is already useful.
 */
export const pullRequestSchema = z.object({
  /**
   * The pull request's page, e.g.
   * `https://github.com/alepha-dev/alepha/pull/118`. Deduped on, ignoring
   * case and a trailing slash.
   */
  url: z.string().max(500),
  /**
   * Its number on the forge, when the caller has it.
   */
  number: z.integer().optional(),
  /**
   * e.g. `alepha-dev/alepha`. Free text; Lore never resolves it.
   */
  repo: z.string().max(200).optional(),
  /**
   * Its title, when the caller has it.
   */
  title: z.string().max(500).optional(),
  at: z.datetime(),
  by: z.uuid(),
});

export type PullRequest = Infer<typeof pullRequestSchema>;

/**
 * The shape a caller sends. `at` and `by` are stamped server-side, so a
 * caller cannot backdate the trail or credit someone else with it.
 */
export const pullRequestInputSchema = z.object({
  url: z
    .string()
    .min(1)
    .max(500)
    .regex(PULL_REQUEST_URL_PATTERN)
    .describe(
      "The pull request's URL, http or https. Deduped, so a repeat is a no-op.",
    ),
  number: z
    .integer()
    .min(1)
    .describe("Its number on the forge, e.g. 118.")
    .optional(),
  repo: z
    .string()
    .max(200)
    .describe("Which repository, e.g. `alepha-dev/alepha`. Free text.")
    .optional(),
  title: z.string().max(500).describe("Its title.").optional(),
});

export type PullRequestInput = Infer<typeof pullRequestInputSchema>;

/**
 * A URL in the form the trail compares and keeps: trimmed, without a
 * trailing slash.
 */
const normalizeUrl = (url: string): string => url.trim().replace(/\/+$/, "");

/**
 * Append pull requests to a trail, deduped on the URL.
 *
 * Compared ignoring case, because forges do not tell `Alepha-Dev/Alepha`
 * from `alepha-dev/alepha`, and a trail listing one pull request twice is
 * worse than useless. Idempotent: a URL the trail already carries leaves it
 * alone rather than erroring or overwriting, so an agent retrying a dropped
 * call is safe. The same rule as `QuestController.appendCommits`.
 */
export const appendPullRequests = (
  existing: PullRequest[] | undefined,
  incoming: PullRequestInput[],
  userId: string,
  at: string,
): PullRequest[] => {
  const trail = [...(existing ?? [])];
  const seen = new Set(trail.map((pr) => normalizeUrl(pr.url).toLowerCase()));

  for (const pr of incoming) {
    const url = normalizeUrl(pr.url);
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    trail.push({
      url,
      number: pr.number,
      repo: pr.repo?.trim() || undefined,
      title: pr.title?.trim() || undefined,
      at,
      by: userId,
    });
  }

  return trail;
};
