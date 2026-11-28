import { z } from "alepha";

import { pullRequestInputSchema } from "../../api/schemas/pullRequestSchema.ts";

/**
 * A pull request as `quest_pull_request_add` and `epic_pull_request_add`
 * accept one (#Q3707). `at` and `by` are stamped server-side.
 *
 * Its number is `pr_number` here, not `number`: on the epic tool `number`
 * already names the epic, and the two tools take the same fields.
 */
export const pullRequestParamsShape = {
  url: pullRequestInputSchema.shape.url,
  pr_number: z
    .integer()
    .min(1)
    .describe("The pull request's number on the forge, e.g. 118.")
    .optional(),
  repo: pullRequestInputSchema.shape.repo,
  title: z
    .string()
    .max(500)
    .describe("The pull request's title, when you have it.")
    .optional(),
};

/**
 * A pull request as `quest_get` and `epic_get` hand one out.
 */
export const pullRequestRefSchema = z.object({
  url: z.string().describe("The pull request's page, the link to open."),
  number: z.integer().optional(),
  repo: z.string().optional(),
  title: z.string().optional(),
  at: z.datetime().describe("When it was recorded, not when it was opened."),
  state: z
    .enum(["open", "draft", "merged", "closed"])
    .describe(
      "Its state on GitHub, for a project connected to GitHub (#Q4367); absent otherwise.",
    )
    .optional(),
  checks: z
    .enum(["none", "pending", "passing", "failing"])
    .describe("Its checks on the head commit, rolled up.")
    .optional(),
  review: z
    .enum(["none", "requested", "approved", "changes_requested"])
    .optional(),
  queued: z.boolean().describe("In GitHub's merge queue.").optional(),
});

/**
 * The params above, in the controller's body shape.
 */
export const pullRequestBodyOf = (params: {
  url: string;
  pr_number?: number;
  repo?: string;
  title?: string;
}) => ({
  url: params.url,
  number: params.pr_number,
  repo: params.repo,
  title: params.title,
});

/**
 * A stored trail as the tools hand it out: without `by`, like a commit.
 */
export const pullRequestRefsOf = (
  trail:
    | Array<{
        url: string;
        number?: number;
        repo?: string;
        title?: string;
        at: string;
      }>
    | undefined,
  states: ReadonlyArray<{
    url: string;
    state: "open" | "draft" | "merged" | "closed";
    checks: "none" | "pending" | "passing" | "failing";
    review: "none" | "requested" | "approved" | "changes_requested";
    queued?: boolean;
  }> = [],
) =>
  (trail ?? []).map((pr) => {
    const state = states.find((it) => it.url === pr.url);
    return {
      url: pr.url,
      number: pr.number,
      repo: pr.repo,
      title: pr.title,
      at: pr.at,
      ...(state
        ? {
            state: state.state,
            checks: state.checks,
            review: state.review,
            ...(state.queued ? { queued: true } : {}),
          }
        : {}),
    };
  });
