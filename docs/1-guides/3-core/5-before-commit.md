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
clean -> lint -> typecheck -> test -> check-dependencies -> build -> clean
```

This is the same pipeline used in CI. Run it before opening a pull request:

```bash
npx alepha verify
```

## What Each Command Does

### yarn lint

Uses [Biome](https://biomejs.dev/) with `--fix` enabled. Automatically formats code, sorts imports, and applies lint rules. No configuration needed.

### yarn typecheck

Runs `tsc --noEmit` across the entire monorepo. Catches type errors without producing output files.

### yarn test

Runs [Vitest](https://vitest.dev/) with two environments:
- **Node.js**: all `*.spec.ts` files (excluding `*.browser.spec.*`)
- **Browser (jsdom)**: all `*.browser.spec.ts` files

### yarn build

Builds all workspace packages using `tsdown`. Runs as part of `yarn v`.

## Verbose Output

For detailed output from any Alepha CLI command, set these environment variables:

```bash
LOG_FORMAT=pretty LOG_LEVEL=trace npx alepha build
```

This is the default for CI environments.

```yaml

> Verbose is automatically enabled when command is run by Claude Code, making it easier to debug issues.
