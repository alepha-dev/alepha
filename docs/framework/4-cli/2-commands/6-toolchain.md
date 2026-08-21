# Toolchain Commands

Test, lint, typecheck, clean. The everyday commands, each backed by a tool that ships embedded in `alepha` - your project never declares Vitest, oxlint, oxfmt, or TypeScript as dependencies, and upgrading `alepha` moves the whole toolchain at once.

## test

Run tests with Vitest.

```bash
alepha test                       # run everything
alepha test user                  # only specs whose path matches "user"
alepha test test/auth.spec.ts     # a single file
```

| Flag             | Description                  |
| ---------------- | ---------------------------- |
| `--config`, `-c` | Path to a Vitest config file |

Extra Vitest arguments go through the `VITEST_ARGS` environment variable:

```bash
VITEST_ARGS="--coverage" alepha test
```

Write specs in `test/` or co-locate them as `*.spec.ts` next to your source - both are picked up.

## lint

Lint with [oxlint](https://oxc.rs/docs/guide/usage/linter.html), then format with [oxfmt](https://oxc.rs/docs/guide/usage/formatter.html) - two passes of one command:

```bash
alepha lint
```

`oxlint --fix` applies every fix it can and reports what is left; `oxfmt` then formats and sorts imports. The order matters, because a lint fix (dropping an unused import, unwrapping a spread) rewrites code without regard for line width - formatting afterwards is what leaves the tree in a state the next `alepha lint` agrees with.

Lint findings in the `correctness` category are **errors**, so `alepha lint` exits non-zero on a real bug and CI stops. Formatting differences are never an error - they are just fixed.

`.oxlintrc.json` and `.oxfmtrc.json` are created if missing, so the command works on a bare project. Both, or neither: a formatter with no linter silently stops gating, and a linter with no formatter reformats to oxfmt's Prettier defaults, tabs included.

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
