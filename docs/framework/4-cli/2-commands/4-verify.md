# Verify Command

Run every check at once. The `verify` command is your pre-commit, pre-deploy, "is this thing ready?" command. If it passes, your code is solid.

## Quick Start

```bash
alepha verify
```

Grab a coffee. When you get back, you'll know if your code is production-ready.

## Options

| Flag | Description |
|------|-------------|
| (none) | Runs the full pipeline with no flags needed |

## What It Does

The `verify` command runs a complete quality pipeline:

```bash
alepha verify

✓ clean         Clean the project
✓ lint          Format and lint code with Biome
✓ typecheck     Check TypeScript types
✓ test          Run tests with Vitest
✓ db check      Check database migrations
✓ build         Build for production
✓ clean         Clean up build artifacts
```

Each step must pass before the next one runs. If something fails, you'll see exactly what went wrong.

## The Pipeline

### 1. Clean

```bash
alepha clean
```

Removes the `dist/` folder. Starts fresh.

### 2. Lint

```bash
alepha lint
```

Formats and lints your code with Biome (`biome check --fix`). Consistent style, no debates. Catches unused variables, suspicious patterns, import problems.

### 3. Typecheck

```bash
alepha typecheck
```

Runs `tsc --noEmit`. Your types must be correct. No `any` sneaking through, no missing properties, no incorrect function calls.

### 4. Test

```bash
alepha test
```

Runs Vitest (embedded in `alepha` — nothing to install). Your tests must pass. All of them.

> **Optional Step**
>
> This step is skipped if the project has no tests — no `test/` directory and no `*.spec.{ts,tsx,js,jsx}` files under `src/`.

### 5. Database Migrations Check

```bash
alepha db migrations check
```

Verifies your Drizzle migrations are in sync with your schema.

> **Always Runs**
>
> This step is deliberately unconditional. It returns cleanly when the app has no database — but an app with entities and zero migrations now fails here, which is the point: that is the state that ships a server which boots green and 500s on its first query.

### 6. Build

```bash
alepha build
```

Builds your project for production using Vite. For React apps, this runs twice — once for the frontend (browser bundle) and once for the backend (server bundle). The server build is optimized to be serverless-friendly, bundling everything into a single file.

If it can't build, it can't ship. See the [Build Command](/docs/cli-commands-build) documentation for deployment options.

> **Expo Projects**
>
> This step is skipped for Expo projects (they have their own build process).

### 7. Clean Again

```bash
alepha clean
```

Removes build artifacts. Leaves your working directory clean.

## Why This Order?

The order matters:

1. **Lint first** — Format and catch issues early
2. **Typecheck second** — Types depend on clean, linted code
3. **Test third** — Tests depend on correct types
4. **Migrations fourth** — Verify schema consistency
5. **Build last** — Only build if everything else passes

> **Fail Fast**
>
> The pipeline is designed to fail fast. If lint fails, there's no point running tests. If types are wrong, the build will fail anyway.

## When to Run Verify

### Before Committing

```bash
alepha verify && git commit -m "feat(auth): add OAuth support"
```

Don't commit broken code. Your teammates will thank you.

### Before Deploying

```bash
alepha verify && alepha platform up --env production
```

Don't deploy broken code. Your users will thank you.

### In CI/CD

```yaml filename=.github/workflows/ci.yml
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm install
      - run: npx alepha verify
```

Your CI should run `verify`. If it fails, the PR doesn't merge.

### After Pulling Changes

```bash
git pull && alepha verify
```

Make sure the latest code still works on your machine.

## Exit Codes

> **Exit Codes**
>
> Exit code `0` means everything passed. Exit code `1` means something failed. Use this in scripts and CI.

Scripts and CI can check the exit code:

```bash
if alepha verify; then
  echo "Ready to ship!"
else
  echo "Fix the issues first"
  exit 1
fi
```

## Individual Commands

Don't want to run everything? Use the individual commands:

```bash
# Just lint (includes formatting)
alepha lint

# Just typecheck
alepha typecheck

# Just test
alepha test

# Just build
alepha build
```

> **Full Pipeline Recommended**
>
> For final validation, always run the full `verify`. It's comprehensive for a reason — individual commands might miss issues that the full pipeline catches.

## Handling Failures

### Lint Failures

Biome auto-fixes formatting issues but some lint errors need manual fixes. The error messages tell you what's wrong:

```txt
src/auth.ts:42:5 lint/suspicious/noExplicitAny
  Don't use `any` type
```

Fix the issue, then run `verify` again.

### Typecheck Failures

TypeScript errors mean your types don't match your code:

```txt
src/auth.ts:42:5 - error TS2345: Argument of type 'string'
is not assignable to parameter of type 'number'.
```

Fix the type error. If you're stuck, `tsc --noEmit` gives you the full error.

### Test Failures

Read the test output. It shows exactly what failed and why:

```txt
FAIL  src/auth.spec.ts > login > should return token
  AssertionError: expected undefined to equal 'abc123'
```

Fix your code or update the test, depending on what's actually correct.

### Build Failures

Build errors are usually TypeScript errors that `typecheck` missed, or runtime issues:

```txt
Could not resolve './missing-file'
```

Check your imports. Make sure all referenced files exist.

## Speed

The full `verify` is fast — Biome and Vite are blazing quick:

- Format: <1s (Biome is written in Rust)
- Lint: <1s (even on large codebases)
- Typecheck: ~5-30s (depends on project size)
- Test: varies (depends on test count)
- Build: ~5-30s (Vite + Rolldown)

Total: usually under a minute for most projects.

> **Performance Note**
>
> The slowest step is usually TypeScript's type checker. Everything else flies.

## Tips

**Run verify before every PR.** Make it a habit. Broken PRs waste everyone's time.

**Set up a pre-commit hook.** Use husky or similar to run `verify` automatically:

```bash filename=.husky/pre-commit
alepha verify
```

**Don't skip steps.** It's tempting to skip tests "just this once." Don't. The one time you skip is the time you ship a bug.

**Trust the process.** If `verify` passes, your code is ready. If it fails, fix the issue. The pipeline exists to catch problems before users do.

**Keep verify green.** A failing `verify` should be treated as urgent. Fix it before doing anything else.
