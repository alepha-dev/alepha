/**
 * `dependency-update` (#E174): the dependencies a minor or a patch
 * behind, updated into a pull request with the repository's own package
 * manager, safe to run unattended every day (#Q4345).
 *
 * ⚠️ English, never localized: its words name the tools it calls. No
 * secret ever goes in: it leaves Lore on a clipboard or in a job.
 */
export const dependencyUpdatePromptText = `Update the dependencies of the Lore project "{{project}}": {{projectUrl}}

## The package manager

Name it from the lockfile at the repository's root, and use that one only, for every command of this run:

| Lockfile | Package manager | Commands |
| --- | --- | --- |
| \`yarn.lock\` | Yarn | \`yarn up\`, \`yarn install\`, \`yarn dedupe\` |
| \`pnpm-lock.yaml\` | pnpm | \`pnpm update\`, \`pnpm install\` |
| \`package-lock.json\` | npm | \`npm install <name>@<version>\`, \`npm install\` |
| \`bun.lock\` or \`bun.lockb\` | Bun | \`bun update\`, \`bun install\` |

- Its version is the one the repository pins (\`packageManager\` in \`package.json\`, \`.yarnrc.yml\`'s \`yarnPath\`), and its configuration is the repository's: \`.yarnrc.yml\`, \`.npmrc\`, \`pnpm-workspace.yaml\` and \`bunfig.toml\` stand as they are, an age gate on new releases (Yarn's \`npmMinimalAgeGate\`, pnpm's \`minimumReleaseAge\`) included.
- **Never create a second lockfile**: no \`npm install\` in a Yarn repository, no \`package-lock.json\` beside a \`yarn.lock\`. Before you commit, \`git status\` shows no new lockfile.
- **Never loosen the configuration** to get a version through: no editing the age gate, the registry, \`resolutions\` or \`overrides\` for that, no \`--ignore-scripts\`, \`--force\` or \`--legacy-peer-deps\` it does not already use. A version the configuration refuses waits for a later run.
- With no lockfile at the root, or several, update nothing: end with a one-line summary saying which you found.

## Choose

- **Patch and minor only.** A major version is left for a person: name it in the pull request.
- **A \`0.x\` package takes patches only**: from \`0.4.1\` to \`0.4.3\`, never to \`0.5.0\`, which is a major for it.
- **No prerelease** (\`-alpha\`, \`-beta\`, \`-rc\`, \`-next\`, a canary) and **no deprecated version**: the registry's \`deprecated\` field says it.
- **Leave alone what is pinned on purpose**: an exact version where the repository otherwise uses ranges, a \`resolutions\` or \`overrides\` entry, or a version a comment, the agent instructions or a renovate or dependabot configuration says to keep.

## Update

1. Update the manifests and the lockfile with that package manager, then install.
2. Run the checks the repository's agent instructions (AGENTS.md or CLAUDE.md) name. Fix what the update broke when the fix is small and obvious; otherwise leave that package at its version, and when you cannot tell which package broke them, bisect the update rather than give it all up.
3. When the update touches what renders or builds the app (a UI library, the framework, the bundler) and \`playwright-cli\` is on the host (\`command -v playwright-cli\`), start the app as those instructions say, on a port of its own that no other run uses, open its main screens, then stop it: a broken page the checks did not catch is a broken update. Open only the app you started. The pull request says which screens you opened, or that none was.

## Deliver

- Only when the checks pass: commit as the repository asks, push the branch, and open a pull request with \`gh\`. Its description lists what changed (from and to), what was left behind and why.
- Never merge it yourself, and never push to the default branch. If the repository's AGENTS.md or CLAUDE.md lets an agent turn on auto-merge, turn it on once the checks are green, as a rebase merge (\`gh pr merge --auto --rebase\`). Otherwise it waits for review.
- When nothing could be updated with the checks passing, open nothing: end with a one-line summary of why.`;
