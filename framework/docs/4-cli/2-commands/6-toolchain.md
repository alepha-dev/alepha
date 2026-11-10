# Toolchain Commands

Test, lint, typecheck, clean. The everyday commands, each backed by a tool that ships embedded in `alepha` - your project never declares Vitest, oxlint, oxfmt, or a TypeScript checker as dependencies, and upgrading `alepha` moves the whole toolchain at once.

## test

Run tests with Vitest.

```bash
alepha test                       # run everything
alepha test user                  # only specs whose path matches "user"
alepha test test/auth.spec.ts     # a single file
```

| Flag              | Description                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `--config`, `-c`  | Path to a Vitest config file                                                                                          |
| `--shard`         | One slice of the spec files, `<index>/<count>` (e.g. `2/6`): one leg of a CI matrix                                   |
| `--project`, `-p` | Only run these Vitest projects, comma-separated. Accepts globs (`api*`)                                               |
| `--coverage`      | Measure coverage and write `coverage/coverage-summary.json` and `coverage/test-results.json`, keeping the HTML report |

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

## check

Check the source against the framework's conventions: no `Date.now()`, no bare `Error`, no error class, no `zod` import, no `vi.mock()`, no test case outside a `describe`, no code beside a service class, no browser dialog. The [Conventions guide](/docs/guides-testing-conventions) explains each rule; the [reference](/docs/reference-conventions) lists them.

```bash
alepha check                     # every rule, the whole project
alepha check src/api             # one file or directory
alepha check --rule no-date-now  # one rule (comma-separated for several)
alepha check --json              # [{ file, line, column, rule, message, fix }]
alepha check --list              # the rules, with their state in this project
```

It exits non-zero on any finding, and reads the source without booting the app. A genuine exception carries `// alepha-allow <rule>: <reason>` on the line above it. The `check` key of `alepha.config.ts` turns one rule `off` (`check: { rules: { "no-module-code": "off" } }`) or hides paths from every rule (`ignore`); `check: false` removes the step from `alepha verify` only.

## typecheck

Run the TypeScript 7 type checker with no emit. Alias: `alepha tc`.

It runs through `tsgolint`, the same embedded binary that runs `alepha lint`'s type-aware rules, and reports the same diagnostics as `tsc --noEmit`. Each file is checked under its nearest `tsconfig.json`, and only files under the current directory are reported: in a monorepo, run it in each workspace or once at the root.

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

These are the building blocks of [`alepha verify`](/docs/cli-commands-verify), which runs them in order (clean → lint → check → typecheck → test → migrations check → build → clean). Use them individually for the tight inner loop, and `verify` before you commit.
