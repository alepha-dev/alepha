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

```
clean -> lint -> typecheck -> test -> db migrations check -> build -> clean
```

The `test` step is skipped when the project has no tests, and `db migrations check` runs only when a `migrations/` directory exists. This is the same pipeline you should use in CI. Run it before opening a pull request:

```bash
npx alepha verify
```

## What Each Command Does

### yarn lint

Uses [Biome](https://biomejs.dev/) with `--fix` enabled. Automatically formats code, sorts imports, and applies lint rules. No configuration needed.

### yarn typecheck

Runs `tsc --noEmit`. Catches type errors without producing output files.

### yarn test

Runs [Vitest](https://vitest.dev/). Specs live in `test/` or co-located as `*.spec.ts`; browser tests use the `*.browser.spec.ts(x)` extension with a jsdom project in `vitest.config.ts` (see [React Tests](/docs/guides-testing-react-tests)).

### yarn build

Builds the project for production. Build failures are verification failures — if it can't build, it can't ship.

## Verbose Output

For detailed output from any Alepha CLI command, set these environment variables:

```bash
LOG_FORMAT=pretty LOG_LEVEL=trace npx alepha build
```

> Verbose output is automatically enabled when a command is run by Claude Code, making it easier to debug issues.
