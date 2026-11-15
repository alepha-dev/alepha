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
) =>
  (trail ?? []).map((pr) => ({
    url: pr.url,
    number: pr.number,
    repo: pr.repo,
    title: pr.title,
    at: pr.at,
  }));
