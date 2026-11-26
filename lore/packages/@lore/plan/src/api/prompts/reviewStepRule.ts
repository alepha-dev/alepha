/**
 * The review every work prompt runs before its pull request may merge
 * (#Q4332): the work prompts turn on auto-merge (#Q4537), so
 * the review moves into the run. A sub-agent reads the change cold; it never
 * gets the author's reasoning, since a reviewer that shares it agrees with
 * it.
 */
export const reviewStepRule = `## The review, before the pull request may merge

Before you mark the pull request ready, or turn on auto-merge, start a sub-agent to review it deeply. One round:

- Give it the diff against main, the quests with their objectives, and the repository's AGENTS.md or CLAUDE.md. Never your own reasoning or notes: a reviewer that shares them agrees with them.
- Ask it for bugs (a case the change gets wrong, with the input that shows it), for work beyond or short of each quest's objectives, and for anything the repository's instructions require that the change lacks.
- Fix each finding that holds in the commit of the quest it belongs to, run the local checks again, and push. A finding you leave is a comment on its quest, as "A quest not fully done" says.
- Your reply says what the review found and what you fixed.`;
