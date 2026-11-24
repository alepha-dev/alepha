/**
 * `security-check` (#E174): the dependencies audited, a quest per real
 * vulnerability.
 *
 * ⚠️ English, never localized: its words name the tools it calls. No
 * secret ever goes in: it leaves Lore on a clipboard or in a job.
 */
export const securityCheckPromptText = `Check the dependencies of the Lore project "{{project}}" for vulnerabilities: {{projectUrl}}

The code is checked out read-only at the default branch. Change nothing in it.

## Audit

1. Find the lockfiles and run each package manager's own audit, which reads the lockfile and needs no install: \`yarn npm audit --recursive --json\`, \`npm audit --json\`, \`pnpm audit --json\`, \`go list -m -json all\` with \`govulncheck\` when it is installed.
2. For each advisory, decide whether it is real here: is the vulnerable package reached by the code, at runtime, through the vulnerable function or option? A dev-only tool and an unreachable path are noted, not filed.

## File

- One quest per real vulnerability, with \`quest_create\`: the package, the advisory, how the code reaches it, and the version that fixes it. Search the open quests first (\`quest_list\` with a search): when one already covers it, comment on it with \`quest_comment_add\` instead.
- Nothing real to report files nothing: end with a one-line summary.`;
