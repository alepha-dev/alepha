# Contributing to Alepha

Thanks for wanting to contribute. Here's how to do it without wasting your time or ours.

## Before You Start

1. **Check existing issues** — Someone might already be working on it
2. **Open an issue first** for large changes — Let's discuss before you write 2000 lines
3. **Small PRs are better** — Easier to review, faster to merge

## Development Setup

```bash
# clone the repo
git clone https://github.com/alepha-dev/alepha.git
cd alepha

# install dependencies
yarn install

# run the local checks
yarn v
```

`yarn v` runs: install → lint → (typecheck, check:deps, check:conventions,
check:docs, check:i18n, check:migrations) in parallel → test → test:bun. About
three minutes, most of it the unit suite. It needs
[Docker](https://www.docker.com/) running, for the Postgres, Redis and S3
containers the integration tests use.

**It is the inner loop, not the gate.** It does not build, and it runs no e2e.
What proves a change is **pushing the branch**: every branch triggers the full
CI graph (`checks`, `test` x6, `e2e-apps`, `e2e-lore` x6, `e2e-cli`, `docker`,
`bay`), which runs in parallel on GitHub's runners in about five minutes. Push
early, keep working, read the result when it lands.

|             |                                                                                                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `yarn v:go` | the Go suite for `apps/bay`, in a container. **`yarn v` does not run it**, and the tests for the systemd half are `//go:build linux`, so a native `go test` on macOS compiles them and runs none. Run this if you touched `apps/bay` |

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
