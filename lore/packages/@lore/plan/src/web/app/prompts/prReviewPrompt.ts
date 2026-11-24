/**
 * The built-in default for `prReview` (#Q4251): an agent job reviewing a
 * pull request, from the quest page's rail, `lore agent run review-pr` or
 * `agent_run`. It runs on an Agent host with the pull request's head checked
 * out (or, for "review and fix", its branch), so it needs no clone.
 *
 * `{{number}}` is the pull request's number, `{{title}}` "pull request #n",
 * `{{url}}` its page, and
 * `{{reference}}` the quest it was recorded on when there is one, the pull
 * request otherwise.
 *
 * See {@link epicReviewPromptDefault} for why this text is English and
 * carries no secrets.
 */
export const prReviewPromptDefault = `Review {{title}} of the Lore project "{{project}}": {{url}}

## Read

1. The diff against its base: \`gh pr diff {{number}}\`, and \`gh pr view {{number}}\` for its description and its checks.
2. What it is for: {{reference}} in Lore (\`quest_get\` when it names a quest), and the repository's own agent instructions (AGENTS.md or CLAUDE.md).
3. The code around what changed, enough to judge it: callers, tests, the conventions the repository states.

## Judge

- Does it do what its quest asks, and nothing it does not?
- Bugs: a case the change gets wrong, with the input that shows it.
- What the repository's instructions require that it misses: tests, docs, naming.
- Nits last, and only the ones worth a reader's time.

## Report

1. Post the review on the pull request with \`gh pr review {{number}}\`: \`--comment\` with your findings, most severe first, each with the file and the line. Approve or request changes only when the repository's instructions say an agent may.
2. Summarise it on {{reference}} with \`quest_comment_add\` when it names a quest: the verdict in one line, and the pull request.`;
