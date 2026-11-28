import { z } from "alepha";

/**
 * The flags `lore quest pull-request add` and `lore epic pull-request add`
 * share, named after the MCP tools' params: `--pr-number`, because on the
 * epic tool `number` names the epic.
 */
export const pullRequestFlags = {
  url: z.text({
    maxLength: 500,
    description:
      "The pull request's URL, e.g. https://github.com/acme/crm/pull/118.",
  }),
  "pr-number": z
    .integer()
    .min(1)
    .describe("Its number on the forge, e.g. 118.")
    .optional(),
  repo: z
    .text({
      maxLength: 200,
      description: "Which repository, e.g. acme/crm.",
    })
    .optional(),
  title: z
    .text({ maxLength: 500, description: "The pull request's title." })
    .optional(),
};

/**
 * The flags above, in the body `addQuestPullRequest` and
 * `addEpicPullRequest` take.
 */
export const pullRequestBodyOf = (flags: {
  url: string;
  "pr-number"?: number;
  repo?: string;
  title?: string;
}) => ({
  url: flags.url,
  number: flags["pr-number"],
  repo: flags.repo,
  title: flags.title,
});

/**
 * What a write says it recorded: the number when there is one, else the URL.
 */
export const pullRequestLabelOf = (flags: {
  url: string;
  "pr-number"?: number;
}): string =>
  flags["pr-number"] ? `pull request #${flags["pr-number"]}` : flags.url;

/**
 * One line of a `get`'s pull request section.
 */
export const pullRequestLineOf = (pr: {
  url: string;
  number?: number;
  title?: string;
  state?: string;
  checks?: string;
}): string =>
  [
    pr.number ? `#${pr.number}` : undefined,
    pr.state
      ? `[${pr.state}${pr.checks && pr.checks !== "none" ? `, checks ${pr.checks}` : ""}]`
      : undefined,
    pr.title,
    pr.url,
  ]
    .filter(Boolean)
    .join("  ");
