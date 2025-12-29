# Changelog Command

Generate beautiful release notes from your git history. No more manually writing changelogs or forgetting what you shipped last week.

## Quick Start

```bash
# What's new since your last release?
alepha changelog

# Compare against a specific version
alepha changelog --from=1.0.0

# Save it to a file
alepha changelog > CHANGELOG.md
```

That's it. The command reads your commits, filters out the noise, and outputs clean markdown to stdout. Pipe it wherever you need.

## How It Works

The changelog command uses a simple but powerful rule: **only commits with both a type AND a scope make it to release notes**.

```
feat(auth): add OAuth2 support       # Included
fix(api): handle timeout errors      # Included
wip: still working on this           # Ignored
auth: debugging session bug          # Ignored
```

This isn't arbitrary. There's a good reason for it.

### Why Require Both Type and Scope?

When you're deep in development, you commit often. Quick fixes, experiments, WIP checkpoints. These commits are useful for your git history, but they don't belong in release notes that users read.

By requiring both a type (`feat`, `fix`) and a scope (`auth`, `api`, `ui`), you're making a conscious choice: *"This commit is release-worthy."*

Think of it as two gates:
- **Type** = What kind of change? (feature, bugfix)
- **Scope** = What part of the system? (auth, api, cli)

Both gates must open for a commit to appear in your changelog. This keeps your release notes focused on what actually matters to users.

## Commit Format

### The Basic Pattern

```
type(scope): description
```

Where:
- `type` is one of: `feat`, `fix`, `docs`, `refactor`, `perf`, `revert`
- `scope` is the area of your codebase: `auth`, `api`, `ui`, `cli`, etc.
- `description` explains what changed in plain English

> **Limited Output Types**
>
> Currently, only `feat` and `fix` commits appear in the generated changelog. The other types (`docs`, `refactor`, `perf`, `revert`) are recognized and parsed, but not yet listed in the output. This may change in future versions.

### Examples That Work

```bash
git commit -m "feat(auth): add passwordless login"
git commit -m "fix(api): prevent duplicate webhook deliveries"
git commit -m "feat(ui): redesign settings page"
git commit -m "perf(db): add index for user lookups"
```

### Examples That Don't (And That's OK)

```bash
git commit -m "wip: experimenting with new approach"
git commit -m "fix: typo"
git commit -m "api: debugging"
git commit -m "checkpoint"
```

These commits are fine for your development flow. They just won't clutter your release notes.

## Breaking Changes

When you're shipping something that might break existing code, mark it with `!`:

```bash
git commit -m "feat(api)!: change authentication response format"
git commit -m "fix(sdk)!: rename Client to ApiClient"
```

The `!` before the colon flags this as a breaking change. It'll appear in a prominent "Breaking Changes" section at the top of your changelog, so users know to pay attention.

You can also include "breaking" in the description:

```bash
git commit -m "feat(api): breaking change to token format"
```

Both approaches work. Use whatever feels natural.

## Options

| Flag | Alias | Description |
|------|-------|-------------|
| `--from=<version>` | `-f` | Show changes from this version to HEAD |

Without `--from`, the command automatically finds your latest semver tag (like `1.2.3`) and shows everything since then.

## What Gets Included (Cheat Sheet)

| Commit Message | In Changelog? | Reason |
|----------------|---------------|--------|
| `feat(ui): add dark mode` | Yes | Has type + scope |
| `fix(auth): session expiry bug` | Yes | Has type + scope |
| `feat(api)!: new endpoints` | Yes | Breaking change, has type + scope |
| `fix: quick hotfix` | No | Missing scope |
| `auth: investigating issue` | No | Missing type |
| `feat(chore): update deps` | No | Scope is in ignore list |
| `wip: checkpoint` | No | Not conventional format |

## Configuration

### Ignoring Certain Scopes

Some scopes represent internal work that shouldn't appear in public release notes. Configure this in `alepha.config.ts`:

```typescript
import { changelogOptions } from "alepha/cli";

export default (alepha: Alepha) => {
  alepha.set(changelogOptions, {
    ignore: ["project", "release", "chore", "ci", "build", "test"],
  });
};
```

### Default Ignored Scopes

Out of the box, these scopes are filtered out:

- `project`, `release`, `starter`, `example` — meta/project management
- `chore`, `ci`, `build`, `test`, `style` — internal tooling

This means `feat(ci): add deploy workflow` won't appear in your changelog. If you want CI changes visible to users, either remove `ci` from the ignore list or use a different scope.

## Output Example

Here's what the generated markdown looks like:

```markdown
## Changes since 1.0.0

### Breaking Changes

- **api**: remove deprecated v1 endpoints (`abc1234`)

### Features

- **auth**: add OAuth2 provider support (`def5678`)
- **ui**: redesign dashboard with new charts (`ghi9012`)
- **cli**: add `alepha deploy` command (`jkl3456`)

### Bug Fixes

- **api**: fix rate limiting for batch requests (`mno7890`)
- **auth**: resolve token refresh race condition (`pqr1234`)
```

Each entry includes the scope in bold, the description, and a short commit hash for reference.

## Workflow Recommendations

### During Development

Commit freely. Use whatever messages help you:

```bash
git commit -m "wip: trying new approach"
git commit -m "auth: still debugging"
git commit -m "checkpoint before refactor"
```

These won't pollute your changelog.

### When You're Done

Squash or amend into a proper conventional commit:

```bash
git commit -m "feat(auth): implement refresh token rotation"
```

Or just commit properly from the start when you know the work is complete.

### Before a Release

Run the changelog command to preview what's going out:

```bash
alepha changelog
```

Review the output. If something's missing that should be there, you might have forgotten the scope. If something's included that shouldn't be, check if that scope should be in your ignore list.

### Generating Release Notes

```bash
# For GitHub releases
alepha changelog > release-notes.md

# For a specific version range
alepha changelog --from=1.2.0 > RELEASE_1.3.0.md

# Append to existing changelog, like a hacker
alepha changelog >> CHANGELOG.md
```

## Tips

**Start scopes small.** Begin with broad scopes like `api`, `ui`, `cli`. Split into `api/users`, `api/billing` only when you need that granularity.

**Be consistent.** Pick scope names and stick with them. `auth` vs `authentication` vs `login` — choose one.

**Write for users.** The description should make sense to someone who uses your software, not just your team. "Fix auth bug" is less helpful than "Fix session expiring during checkout."

**Don't stress about WIP.** The whole point of requiring scope is that you can commit however you want during development. The changelog filters it down to what matters.
