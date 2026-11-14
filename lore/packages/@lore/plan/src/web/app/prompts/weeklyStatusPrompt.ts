/**
 * The built-in default for `weeklyStatus`: Agent Prompts > Write the weekly
 * status, offered on the Reports Summary tab (#Q3015).
 *
 * ⚠️ **Surface-scoped**, like `questLoop`: its subject is an
 * {@link AgentPromptProjectSubject}, so `{{reference}}`, `{{number}}`, `{{id}}`
 * and `{{title}}` must not appear below.
 *
 * See {@link epicReviewPromptDefault} for why this text is English and
 * carries no secrets.
 */
export const weeklyStatusPromptDefault = `Write the weekly status update of the Lore project "{{project}}".

The reports: {{url}}

## Read

1. \`project_report\` with project_name "{{project}}", days 7 and section "summary". It compares the week with the one before.
2. For each figure that moved, the section that explains it: "flow", "backlog", "planning", "support", "knowledge", "delivery" or "team". Skip the sections of a capability the project does not have.
3. \`project_activity\` for the week, to name what the figures only count: the releases published and the epics finished.

## Write

A status a reader can act on in a minute, in Markdown:

- **The week in one line.**
- **What shipped**, named, not counted.
- **What moved**, each figure with the previous one and the likely reason. A reason you could not establish from the data says so.
- **What needs a decision**: what is blocked, overdue or stale, and who can unblock it.

Report on the work, never on who did the most: no ranking of people.

Answer in your reply. Change nothing in the project.`;
