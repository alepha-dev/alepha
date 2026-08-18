# Before Commit

Every code change must pass linting, type checking, and tests before being committed.

## Required Checks

Run these three commands after every modification:

```bash
yarn lint       # Format and lint with Biome (auto-fixes)
yarn typecheck  # TypeScript type checking (tsc --noEmit)
yarn test       # Run Vitest test suite
```

If any command fails, fix the issue before committing. Do not skip these steps.

## Full Verification

`alepha verify` runs the full pipeline:

```txt
clean -> lint -> typecheck -> test -> db migrations check -> build -> clean
```

The `test` step is skipped when the project has no tests, and `build` is skipped for Expo projects. `db migrations check` always runs: it returns cleanly when the app has no database, so a project with entities and no migrations fails here instead of in production — that is deliberate. This is the same pipeline you should use in CI. Run it before opening a pull request:

```bash
npx alepha verify
```

## What Each Command Does

### yarn lint

Uses [Biome](https://biomejs.dev/) with `--fix` enabled. Automatically formats code, sorts imports, and applies lint rules. No configuration needed.

### yarn typecheck

Runs `tsc --noEmit`. Catches type errors without producing output files.

### yarn test

Runs [Vitest](https://vitest.dev/). Specs live in `test/` or co-located as `*.spec.ts`; browser tests use the `*.browser.spec.ts(x)` extension with a jsdom project in `vite.config.ts` (see [React Tests](/docs/guides-testing-react-tests)).

### yarn build

Part of `alepha verify` rather than the per-commit trio. Builds the project for production; build failures are verification failures — if it can't build, it can't ship.

## Verbose Output

For detailed output from any Alepha CLI command, set these environment variables:

```bash
LOG_FORMAT=pretty LOG_LEVEL=trace npx alepha build
```

> Verbose output is automatically enabled when a command is run by Claude Code, making it easier to debug issues.
