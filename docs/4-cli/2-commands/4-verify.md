# Verify Command

`alepha verify` runs the configured verification command and exits nonzero when a step fails. Read the project's pipeline before treating a local result as a release gate.

```bash
alepha verify
```

## Default application pipeline

Without a project override, the framework runs these steps sequentially:

1. Clean generated build artifacts.
2. Lint with oxlint, then format with oxfmt.
3. Typecheck.
4. Run Vitest when specs exist.
5. Check database migrations (returns cleanly when no database is declared).
6. Build, except for Expo projects.
7. Clean generated build artifacts again.

The first failure stops the pipeline. This checks the app's default build, not every runtime, deployed environment, browser flow or SSR response. There are no verify flags. Project CLI extensions can replace the command.

## This repository's inner loop

The Alepha monorepo overrides verification: `yarn v` installs dependencies, runs copy/generators and lint, then typecheck and the four `check:*` audits in parallel, then the Node and Bun test lanes. It neither cleans nor builds. Docker test services must be running, and a shared lock serializes runs across worktrees. Generated docs must be reviewed and staged before `check:docs` passes.

The repository's branch CI is the release gate: checks, six test jobs, app e2e and CLI e2e. A green local pipeline cannot catch every build, SSR or browser regression. Follow the repository's `CLAUDE.md`, push the branch, and read the complete CI result before landing it.

## Local feedback and deployment

Use individual checks for quick feedback while changing code:

```bash
alepha lint
alepha typecheck
alepha test
alepha db migrations check
```

Build the runtime artifact and run the project's integration checks separately when its verification pipeline does not cover them:

```bash
alepha build --runtime workerd
```

That plain Worker build needs no cloud credentials. With explicit [infra configuration](/docs/cli-plugins-infra), `alepha deploy` runs authentication, provisioning, build, migration, deployment and secret handling. `--prebuilt` preserves that lifecycle while refreshing deploy configuration around an existing bundle. `alepha infra deploy` instead authenticates and calls only the adapter's deploy step against a suitable existing artifact.

## Failures

Read the failing step's output, correct the cause, and rerun the required pipeline. Exit code zero means its configured checks passed; it does not prove that a deployment works. Keep tests and migration checks in the project's CI, and include build/e2e coverage for the behavior being shipped.
