# Toolchain Commands

Test, lint, typecheck, clean. The everyday commands, each backed by a tool that ships embedded in `alepha` - your project never declares Vitest, Biome, or TypeScript as dependencies, and upgrading `alepha` moves the whole toolchain at once.

## test

Run tests with Vitest.

```bash
alepha test                       # run everything
alepha test user                  # only specs whose path matches "user"
alepha test test/auth.spec.ts     # a single file
```

| Flag | Description |
|------|-------------|
| `--config`, `-c` | Path to a Vitest config file |

Extra Vitest arguments go through the `VITEST_ARGS` environment variable:

```bash
VITEST_ARGS="--coverage" alepha test
```

Write specs in `test/` or co-locate them as `*.spec.ts` next to your source - both are picked up.

## lint

Format and lint with Biome (`biome check --fix`). Auto-fixes formatting and import order; remaining issues are reported.

```bash
alepha lint
```

A `biome.json` is created if missing, so the command works on a bare project.

## typecheck

Run TypeScript's type checker with no emit (`tsc --noEmit`). Alias: `alepha tc`.

```bash
alepha typecheck
```

A `tsconfig.json` is created if missing.

## clean

Remove the build output directory (`dist/` by default, or `build.output.dist` from your config).

```bash
alepha clean
```

## Together

These are the building blocks of [`alepha verify`](/docs/cli-commands-verify), which runs them in order (clean → lint → typecheck → test → migrations check → build → clean). Use them individually for the tight inner loop, and `verify` before you commit.
