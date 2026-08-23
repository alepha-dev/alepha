# Contributing to Alepha

Thanks for wanting to contribute. Here's how to do it without wasting your time or ours.

## Before You Start

1. **Check existing issues** — Someone might already be working on it
2. **Open an issue first** for large changes — Let's discuss before you write 2000 lines
3. **Small PRs are better** — Easier to review, faster to merge

## Development Setup

```bash
# clone the repo
git clone https://github.com/feunard/alepha.git
cd alepha

# install dependencies
yarn install

# run the full verification pipeline
yarn v
```

`yarn v` runs: clean → copy → lint → check:docs → check:deps → check:conventions →
typecheck → check:i18n → check:migrations → test → test:bun → build → e2e →
clean. If it passes, you're good. It needs
[Docker](https://www.docker.com/) running, for the Postgres, Redis, S3 and MQTT
containers the integration tests use, and it should finish inside 10 minutes.

Two narrower entry points, for when the full run is more than you need:

|                 |                                                                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `yarn v --fast` | lint, then typecheck / test / test:bun / the five audits (deps, conventions, docs, i18n, migrations) in parallel. Skips the build and e2e. The one to use while iterating                                                            |
| `yarn v:go`     | the Go suite for `apps/bay`, in a container. **`yarn v` does not run it**, and the tests for the systemd half are `//go:build linux`, so a native `go test` on macOS compiles them and runs none. Run this if you touched `apps/bay` |

## Making Changes

### 1. Create a Branch

```bash
git checkout -b fix/short-description
# or
git checkout -b feat/short-description
```

### 2. Write Code

Follow the existing patterns. Look at similar code in the repo and match the style.

Key rules:

- Use `protected` instead of `private` for class members
- Use `$` prefix for primitives (`$action`, `$entity`, etc.)
- Use dependency injection via `$inject()`
- Write tests for new features

### 3. Run Checks

```bash
yarn lint       # auto-fixes formatting
yarn typecheck  # must pass
yarn test       # must pass
```

For package-specific work:

```bash
yarn w alepha typecheck
yarn w alepha test
```

### 4. Commit

Write clear commit messages:

```
fix: handle null response in HttpClient

The client was throwing when the server returned 204 No Content.
Now it returns undefined instead.
```

Format: `type(module): short description`

Types: `fix`, `feat`, `docs`, `refactor`, `test`, `chore`

### 5. Open a PR

- Fill out the PR template
- Link related issues
- Wait for CI to pass
- Respond to review feedback

## What We're Looking For

**Good contributions:**

- Bug fixes with tests
- Documentation improvements
- Performance improvements with benchmarks
- New features that fit the framework's philosophy

**Not a good fit:**

- Breaking changes without discussion
- Features that add complexity without clear benefit
- Code without tests

## Questions?

Open an issue or start a discussion. We don't bite.
