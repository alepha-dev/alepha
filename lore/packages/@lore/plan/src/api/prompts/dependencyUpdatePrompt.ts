/**
 * `dependency-update` (#E174): the dependencies a minor or a patch
 * behind, updated into a pull request.
 *
 * ⚠️ English, never localized: its words name the tools it calls. No
 * secret ever goes in: it leaves Lore on a clipboard or in a job.
 */
export const dependencyUpdatePromptText = `Update the dependencies of the Lore project "{{project}}": {{projectUrl}}

## Choose

Update the ones outdated by a minor or a patch version. A major version is left for a person: name it in the pull request.

## Update

1. Update the manifests and the lockfile with the repository's package manager, then install.
2. Run the checks the repository's agent instructions (AGENTS.md or CLAUDE.md) name. Fix what the update broke when the fix is small and obvious; otherwise leave that package at its version.

## Deliver

- Only when the checks pass: commit as the repository asks, push the branch, and open a pull request with \`gh\`. Its description lists what changed (from and to), what was left behind and why.
- When nothing could be updated with the checks passing, open nothing: end with a one-line summary of why.`;
