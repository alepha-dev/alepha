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
check:docs, check:migrations) in parallel → test → test:bun → test:broker.
About three minutes, most of it the unit suite. It needs
[Docker](https://www.docker.com/) running, for the Postgres, Redis, S3 and
Mosquitto containers the integration tests use.

**It is the inner loop, not the gate.** It does not build, and it runs no e2e.
What proves a change is **pushing the branch**: every branch triggers the full
CI graph (`checks`, `test` x6, `e2e-apps`, `e2e-cli`), which runs in parallel
on GitHub's runners in about five minutes. Push early, keep working, read the
result when it lands.

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

### Dependency ranges

A pre-1.0 dependency (`0.x`) keeps its **caret**: on `0.x`, `^0.7.1` already
means "this minor only" (`>=0.7.1 <0.8.0`), so it takes patch fixes and never
a breaking minor. A tilde would say the same less readably, and an exact pin
blocks the patch fixes.

The next minor of a `0.x` dependency is a breaking release by semver, so it
is bumped deliberately: **one minor per commit**, with nothing else in it,
then `yarn dedupe`.

A `0.x` library with no release for two years is abandoned: replace it, or
record in the commit that touches it why it stays.

Exact pins are the exception, and each has its reason written down:

- `@capgo/capacitor-updater` in `@alepha/capacitor` is pinned to the version
  whose over-the-air wire contract was proven on the iOS simulator and the
  Android emulator (#Q2524). Bumping it means re-running
  `apps/examples/mobile/scripts/ota-conformance.ts` against the new version.
- `sharp` in `@alepha/capacitor` is pinned, and `src/packaging.spec.ts`
  asserts it: it ships a native libvips binary per platform, so the version
  that generates an app's icons is chosen, not resolved.

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
