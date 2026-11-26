/**
 * `review-pr` (#E174): a pull request of the project's repository
 * reviewed, its findings posted on it.
 *
 * ⚠️ English, never localized: its words name the tools it calls. No
 * secret ever goes in: it leaves Lore on a clipboard or in a job.
 */
export const reviewPrPromptText = `Review {{pullRequest.title}} of the Lore project "{{project}}": {{pullRequest.url}}

## Read

1. The diff against its base: \`gh pr diff {{pullRequest.number}}\`, and \`gh pr view {{pullRequest.number}}\` for its description and its checks.
2. What it is for: the quest its title, its description or its branch names in Lore (\`quest_get\`), and the repository's own agent instructions (AGENTS.md or CLAUDE.md).
3. The code around what changed, enough to judge it: callers, tests, the conventions the repository states.
4. What a person sees, when it changes a screen: with \`playwright-cli\` on the host (\`command -v playwright-cli\`), start the app from the pull request's code as the repository's agent instructions say, on a port of its own that no other run uses, open each changed screen and compare it with what the quest asks, then stop the app. Open only the app you started. Without it, the review says no screen was looked at.

## Judge

- Does it do what its quest asks, and nothing it does not?
- Bugs: a case the change gets wrong, with the input that shows it.
- What the repository's instructions require that it misses: tests, docs, naming.
- Nits last, and only the ones worth a reader's time.

## Report

1. Post the review on the pull request with \`gh pr review {{pullRequest.number}}\`: \`--comment\` with your findings, most severe first, each with the file and the line. Approve or request changes only when the repository's instructions say an agent may.
2. Summarise it on its quest with \`quest_comment_add\` when it names one: the verdict in one line, and the pull request.`;
