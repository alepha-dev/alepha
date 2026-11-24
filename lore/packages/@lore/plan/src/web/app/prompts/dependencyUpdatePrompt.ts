/**
 * The built-in default for `dependencyUpdate` (#Q4252): an agent job that
 * updates dependencies and opens a pull request, run on an Agent host by hand
 * (`lore agent run dependency-update`) or by an automation. It runs in a
 * worktree on a branch Lore names.
 *
 * ⚠️ **Surface-scoped**, like `weeklyStatus`: it names no item, so
 * `{{reference}}`, `{{number}}`, `{{id}}` and `{{title}}` must not appear.
 *
 * See {@link epicReviewPromptDefault} for why this text is English and
 * carries no secrets.
 */
export const dependencyUpdatePromptDefault = `Update the dependencies of the Lore project "{{project}}": {{url}}

## Choose

- When this run's request below names packages, update those.
- Otherwise update the ones outdated by a minor or a patch version. A major version is left for a person: name it in the pull request.

## Update

1. Update the manifests and the lockfile with the repository's package manager, then install.
2. Run the checks the repository's agent instructions (AGENTS.md or CLAUDE.md) name. Fix what the update broke when the fix is small and obvious; otherwise leave that package at its version.

## Deliver

- Only when the checks pass: commit as the repository asks, push the branch, and open a pull request with \`gh\`. Its description lists what changed (from and to), what was left behind and why.
- When nothing could be updated with the checks passing, open nothing: end with a one-line summary of why.`;
