# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alepha is a convention-driven TypeScript framework for building robust, end-to-end type-safe applications.
This is a monorepo workspace using Yarn workspaces with the following structure:

- `apps/*` - Example applications
- `packages/*` - Framework workspace

## Environment Variables for Commands

When running Alepha CLI commands (build, dev, etc.), use these environment variables for verbose output:
- `LOG_FORMAT=pretty` - Human-readable colored log output
- `LOG_LEVEL=trace` - Maximum verbosity (trace, debug, info, warn, error)

Example:
```bash
LOG_FORMAT=pretty LOG_LEVEL=trace yarn w @alepha/devtools build
```

## Development Commands

### Core Commands
- `yarn v` or `yarn alepha verify` - Full verification pipeline: clean, lint, typecheck, test, check:deps, check:i18n, check:migrations, build, e2e, clean. **JavaScript/TypeScript only — it does NOT run the Go suite.** Must complete within 10 minutes; always run it with a 10-minute timeout. If it exceeds 10 minutes, treat that as a failure (a hung step, usually e2e) and investigate, do not just wait longer.
  - **Needs Docker running** for the service checks (postgres, redis, s3mock, emqx).
- `yarn v:go` - The Go lane: `apps/bay`'s suite in a container (gofmt, vet, build, tests, cross-compile), reproducing the `bay` CI job. **Run it when you touch `apps/bay`** — `yarn v` will not, and a green `yarn v` says nothing about Go.
  - Separate rather than gated on a `git diff` because a heuristic that misfires skips silently. This one cannot be silently wrong.
  - Not `yarn w bay test`: the native pass is GREEN while skipping every test of `Systemd.render()`, whose files are `//go:build linux` and never compile on macOS.
  - The `bay` CI job runs unconditionally on every PR and push, so nothing reaches main unchecked either way.
- `yarn v --fast` - Inner-loop sanity check: lint + (typecheck, test, test:bun, check:deps, check:i18n, check:migrations) in parallel. Skips clean/copy/build/e2e and, like `yarn v`, all Go. Use for tight iteration.
- `yarn clean` or `yarn alepha clean` - Remove all generated files and node_modules
- `yarn build` - Build all workspace packages using `tsdown`
- `yarn test` - Run all tests using Vitest
- `yarn lint` - Format and lint using Biome (with `--fix` flag)
- `yarn typecheck` - TypeScript type checking (`tsc --noEmit`)

### Workspace-aggregated Checks

These fan out via `yarn workspaces foreach -Apt run …`, so every workspace that exposes the matching script participates. Workspaces without the script are silently skipped — opt in by adding the named script to your `package.json`.

- `yarn check:deps` - depcheck across every workspace (unused/missing deps)
- `yarn check:i18n` - i18n catalog audit (each app's `alepha i18n check`)
- `yarn check:migrations` - DB migration drift check (each app's `alepha db migrations check`)

The convention is `check:<thing>` at the app level → `yarn check:<thing>` at the root that fans out. To add a new check that spans apps, follow the same shape (workspace script + root aggregator + add it to the `verify` pipeline in `alepha.config.ts`).

### Workspace Commands
- `yarn w <workspace> <command>` - Run commands in specific workspace
  - Examples:
    - `yarn w alepha test` - Run tests for alepha package
    - `yarn w @alepha/ui typecheck` - Type check @alepha/ui package
    - `yarn w @alepha/devtools build` - Build @alepha/devtools package

## Architecture

### Framework Core
- Uses primitive-based architecture with `$` prefixed primitives (`$action`, `$entity`, `$repository`, etc.)
- Dependency injection container in `alepha`
- Convention-driven with minimal configuration
- Documentation: https://alepha.dev/llms.txt

### Package Organization

Alepha uses a hybrid monorepo structure:

**Unified Package (`alepha`)**
- The `alepha` package exports 50+ framework sub-modules
- Sub-modules can be imported as `alepha/module-name/submodule-name` (e.g., `alepha/server`, `alepha/security`, `alepha/api/users`)
- Provides unified dependency management and consistent versioning
- Located in `packages/alepha/src/` with each sub-module as a directory

**Specialized Packages**
- `@alepha/ui` - Shared shadcn Base UI Nova components. Edit `src/components/` directly. Stock shadcn primitives can be refreshed with `yarn w @alepha/ui sync`, which fetches them from the public `ui.shadcn.com/r/styles/base-nova` registry. Our own blocks (controls, admin, auth, app-shell, alepha-table, …) are not touched by `sync` — they're hand-maintained.
- `@alepha/devtools` - Development tools and inspection UI
- `@alepha/sigil` - The reporting half of a sigil: an app sends its page views, Web Vitals and errors to the sink named by `SIGIL_SINK` + `SIGIL_KEY`. Lore is the sink (`apps/lore`, `SigilIngestController`)
- `@alepha/payments-stripe` - Stripe payments backend
- `@alepha/payments-mollie` - Mollie payments backend
- `@alepha/mqtt` - MQTT transport

### Lore (`apps/lore`)

The only public Alepha application — a project management app at `lore.alepha.dev`. Lore lives in this monorepo specifically to **dogfood the framework**: framework improvements and bug fixes that surface while building Lore are part of the same commit/PR, not a downstream issue. When working on `apps/lore`, treat `packages/alepha` and `packages/@alepha/ui` as fair game — edit them in place, run `yarn v` from the root, ship both sides in one commit.

CI auto-deploys Lore to Cloudflare on every push to `main` via the `deploy-lore-production` job in `.github/workflows/ci.yml`. There is no human gate. Lore migrations (`apps/lore/migrations/sqlite/`) target Cloudflare D1, which has a known cascade-on-DROP-TABLE quirk — see `apps/lore/CLAUDE.md` ("Migration safety on D1") before pushing anything that touches `migrations/sqlite/`.

### Lore MCP — framework planning memory

The Lore MCP (`mcp__claude_ai_Lore__*`) is the long-term planning memory for framework work in this repo. Framework decisions, deferred plans, and bug reports live in the **Alepha project — id `1`**, which since 2026-08-18 holds the whole ecosystem: the former `Lore` (project `2`) and `shop` (project `64`) projects were merged into it. Those two ids still exist but are empty shells — never file anything there.

Everything that came from Lore carries a **shortId offset of +1000** (quest `#208` → `#1208`, folio `#12` → `#1012`), and shop's feedback carries +2000. So a reference above 1000 in an older note means "this was a Lore number" — read it as `n - 1000` when comparing against anything written before the merge.

- Before non-trivial framework changes, orient via `project_context` (project `1`) — returns project metadata, active quests, and the folio index in one shot.
- Read `folio_get` on relevant folios. Folios are how past sessions hand context to future sessions (current examples: #4 Drizzle v1 plan, #5 Stripe-deferred, #6 ui-registry removal).
- **Prefer folios over quests for framework work.** Folios capture decisions, plans, and gotchas — write one (`folio_create` with a good `summary`) whenever a session produces a non-obvious decision or design note. Only create quests when the user explicitly asks.

#### The folio tree is organised — file folios, don't dump them at the root

Project `1` has a directory tree (browse it with `directory_list`). **Directories are subjects, not document types.** Put a new folio under the subject it is about and say which kind of document it is in its `summary`; there are no `plans/` or `specs/` directories, because a spec filed away from its subject is unfindable. (Folio tags are gone — the summary is the only taxonomy left.) Pass `directory_shortId` to `folio_create`:

| Directory | What goes in it |
|---|---|
| `framework` | `packages/alepha` — core, ORM, react, security, build, `@alepha/ui` |
| `lore` | `apps/lore` — the app, its data model, its UI, sigils, MCP |
| `bay` | `apps/bay` — the Go supervisor, its deployment, the VPS |
| `platform` | the deploy chain — `alepha platform`, its adapters, Cloudflare, SSH, npm release |
| `commerce` | `@alepha/commerce` and `apps/examples/shop` |
| `reviews` | dated audits and security reviews that span everything |
| `archive` | retired experiments, kept only where a lesson survives (pulse, bay-admin, outposts) |
| `trash` | superseded folios awaiting real deletion — see below |

**Lifecycle.** When work ships, the *outcome* folio survives and the spec folio moves to `trash`. `trash` is a manual soft-delete: `folio_delete` is immediate and permanent, so nothing is ever deleted outright — it is moved there and left for the user to purge. Do not empty `trash` without being asked.

#### ⚠️ superpowers writes its plans and specs HERE, not to disk

`docs/superpowers/` is in `.gitignore`. A plan written there lives only in the worktree that produced it and **dies when that worktree is removed** — which is exactly what the finishing step does. That has already cost one 1100-line plan, recovered by hand into `assets/`.

So when the `superpowers:writing-plans` or `superpowers:brainstorming` skills produce a plan or a spec, **also persist it as a folio** in project `1`, under its **subject** directory, with a `summary` naming it as a plan or a spec. The file on disk stays the working copy the executing agent reads; the folio is the copy that survives. Update the folio when the plan changes materially, and mark it done or superseded when the work ships.

A plan folio needs: what is being built, the constraints that bind it, and the decisions already taken with their reasons. A future session that reads only the folio should not need the disk copy to understand why.

### Testing

#### Test Configuration
- Uses **Vitest** with global test environment
- Coverage tracking for `packages/*/src/**/*.ts(x)`
- Test databases and Azure storage emulator configuration included via `vitest.config.ts`
- Tests located in `__tests__/` directories within each package / module or as co-located `*.spec.ts` files

#### Test Environments
Two test environments are configured:
1. **Node.js tests** - `*.spec.{ts,tsx}` (excludes `*.browser.spec.*`)
2. **Browser tests (jsdom)** - `*.browser.spec.{ts,tsx}`
   - Use `.browser.spec.ts` or `.browser.spec.tsx` extension for browser tests
   - Automatically uses jsdom environment

#### Running Tests
- **All packages**: `yarn test`
- **Single package**: `yarn w alepha test`
- **Filtered tests**: `yarn w alepha vitest run <pattern>` (e.g., `yarn w alepha vitest run init.spec`)
- **With coverage**: `yarn vitest run --coverage`

#### Ports — dev vs e2e

Two disjoint bands, and they must stay disjoint:

| band | owner |
|---|---|
| `3001-3004` | `apps/benchmark` |
| `3300-3399` | **dev servers** — `dev.port` in each app's `alepha.config.ts` (docs 3302, lore 3303, examples/playground 3304, examples/shop 3305, examples/errors 3306, examples/ssr 3311) |
| `5173+` | dev servers with no `dev.port` (Vite default); also `alepha dev` in multi-app mode, which hands each child `5173 + index` via `SERVER_PORT` and so **overrides `dev.port`** |
| `4300-4999` | **e2e, and nothing else** |
| `11883` / `15432` / `16379` / `19090` | `compose.yml` test services (emqx / postgres / redis / s3mock) |

All six Playwright configs (`apps/docs`, `apps/lore`, and `apps/examples/{playground,shop,ssr}` — ssr twice, prod + dev mode) take their port from `e2ePort("<app>")` in the repo-root `playwright.port.ts`, the same way every vitest config takes its browser project from `vitest.jsdom.ts`. Add port logic there, never to a caller; a new suite needs a slot in `E2E_SLOTS` or it will not typecheck.

The argument is the **app name, not a port**, because it used to be the port — and it was the app's own *dev* port. `yarn dev` and `yarn e2e` in the same app fought over one socket, and with `reuseExistingServer` on, Playwright adopted the dev server and ran the suite against hot-reloaded sources and the dev database, reporting green.

`e2ePort` derives a slot from the **checkout path**, so two worktrees never collide (the probe cannot do this: `yarn start` builds for a minute before binding, so concurrent runs both see the port free), then **bind-tests it and steps a full stride if anything answers**. `reuseExistingServer` is therefore `false` everywhere: a port verified free has no server to reuse, and anything answering on it raced in and is not this run's build. `E2E_PORT` overrides the whole thing.

#### Testing Patterns
- **Automatic Lifecycle**: `Alepha.create()` automatically handles start/stop in test environments
- **Service Substitution**: Use `Alepha.with()` for mocking dependencies (preferred over traditional mocking)
- **Standard Structure**: Follow Arrange-Act-Assert pattern with descriptive test names
- **Error Testing**: Use `expect().toThrow()` for sync errors, `expect().rejects.toThrowError()` for async
- **Shared Functions**: Create reusable test functions for testing multiple implementations

#### Important: Avoid vi.mock
**NEVER use `vi.mock()` or `vi.spyOn()`** - Alepha's DI system makes traditional mocking unnecessary and often problematic. Instead:

1. **Service Substitution** - Replace real services with test implementations:
```typescript
const alepha = Alepha.create()
  .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
  .with({ provide: ShellProvider, use: MemoryShellProvider });
```

2. **Memory Providers** - Use built-in memory implementations for I/O-bound services:
   - `MemoryFileSystemProvider` - In-memory file system with test assertions
   - `MemoryShellProvider` - In-memory shell command tracking
   - `MemoryQueueProvider` - In-memory job queue
   - `MemoryTopicProvider` - In-memory pub/sub
   - `MemoryLockProvider` - In-memory distributed locks
   - `MemorySmsProvider` - In-memory SMS tracking
   - `MemoryFileStorageProvider` - In-memory file storage (buckets)

3. **Test Assertion Helpers** - Memory providers include DX helpers:
```typescript
const fs = alepha.inject(MemoryFileSystemProvider);
expect(fs.wasWritten("/path/file.ts")).toBe(true);
expect(fs.wasWrittenMatching("/path/file.ts", /pattern/)).toBe(true);
expect(fs.wasDeleted("/path/file.ts")).toBe(true);

const shell = alepha.inject(MemoryShellProvider);
expect(shell.wasCalled("yarn install")).toBe(true);
```

4. **TestProvider Pattern** - For unit testing protected methods, create a test subclass:
```typescript
class TestCliProvider extends CliProvider {
  public testParseFlags = this.parseFlags.bind(this);
  public testResolveCommand = this.resolveCommand.bind(this);
}
const cli = alepha.inject(TestCliProvider);
const result = cli.testParseFlags(["--verbose"], flagDefs);
```

5. **CLI Testing** - Use `CliProvider.run()` for lightweight command testing:
```typescript
const cli = alepha.inject(CliProvider);
const cmd = alepha.inject(InitCommand);
await cli.run(cmd.init, { argv: "--react", root: "/project" });
```

#### Common Test Patterns
```typescript
// Basic test structure
test("description", async ({ expect }) => {
  const alepha = Alepha.create();
  class TestApp { /* ... */ }
  const app = alepha.inject(TestApp);
  await alepha.start();

  const result = await app.method();
  expect(result).toBe(expected);
});

// Service substitution (preferred over vi.mock)
const alepha = Alepha.create().with({
  provide: BaseService,
  use: MockService,
});

// Testing with memory providers
const alepha = Alepha.create()
  .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });
const fs = alepha.inject(MemoryFileSystemProvider);
await fs.writeFile("/test/file.txt", "content");
// ... run code that uses FileSystemProvider ...
expect(fs.wasWritten("/test/output.txt")).toBe(true);

// Browser tests
test("should work in browser", async ({ expect }) => {
  // This test will run in jsdom environment
  const element = document.createElement('div');
  expect(element).toBeDefined();
});
```

## Mandatory Requirements After Code Changes

**⚠️ REQUIRED - Must Run After Every Code Modification:**

After updating ANY code in this repository, you MUST execute:
```bash
yarn lint       # Linting - auto-fixes formatting and import order
yarn typecheck  # Type checking - catches TypeScript errors
yarn test       # Unit and integration tests - ensures functionality
```

These commands are **MANDATORY** and non-negotiable. Do not skip them under any circumstances.
- If `yarn typecheck` fails, fix all type errors before proceeding
- If `yarn test` fails, fix all test failures
- If `yarn lint` fails, fix all lint issues

For package-specific work, use:
```bash
yarn w @package-name typecheck && yarn w @package-name test
```

## Code Conventions

Conventions enforced by review, not by lint. They are not obvious from the code, so read them before writing any.

### Core rules

- **Never use `Date.now()`** — inject `DateTimeProvider` and call `this.dateTime.nowMillis()`. This is what makes time testable via `travel()` / `pause()`. Not available inside `alepha/core` or `alepha/datetime` themselves. Note `travel()` also resolves `CronProvider` waits, so every `$job` cron in the container fires — assert end state, not call counts.
- **Never throw `Error`** — always `AlephaError` (import from `"alepha"`); it extends `Error` with `name = "AlephaError"`.
- **Never write code outside classes** — no standalone functions or constants in service files. Everything is a class method so it stays substitutable via DI for testing.
- **No `_` prefix on class members** — use descriptive names.
- **One schema per file** — never declare multiple schemas in one file.

### Typing traps

- **Schemas are Zod, imported as `z` from `"alepha"`.** There is no `t` export — TypeBox was purged before v1. Anything you read that says `t.text()` / `t.object()` / `import { t } from "alepha"` is pre-migration and wrong.
- **`z.any()` is not valid** for `TResponseBody` / `TRequestBody` in `$route` schemas. Use `z.record(z.text(), z.any())`, with `as any` on the return value.
- **`schema.response` is what serializes.** A field added to the entity, the type and the component still will not appear in the payload unless it is declared on the response schema — and it fails silently.
- **`this.alepha.env.*` returns `string | number | boolean`** — coerce with `String()` / `Number()` when assigning to a typed field.
- **`HttpClient.fetch()` without a `schema` option returns `{ data: {} }`** — cast `res.data as any` for untyped endpoints.
- **Never augment zod's `GlobalMeta`** — it poisons every `.meta()` call site and explodes the type graph. Use `satisfies SchemaControlFn` locally instead.

### React components

- **One component per file.** If a file has two, extract the second.
- **File order:** PROPS interface → COMPONENT → the rest (other interfaces, helpers).
- **Extracted component naming:** `ParentComponent.tsx` with an inner `Header` becomes `ParentComponentHeader.tsx`.
- **Always arrow functions:** `const MyComponent = (props: MyComponentProps) => {}` — never `function`.
- **Never destructure props in the parameter list:** use `(props: MyComponentProps)`, not `({ foo }: MyComponentProps)`. Destructure inside the body if you want.
- **Props interfaces are named `MyComponentProps`** — always a named exported interface, never inline.
- **No React Context** — use `$atom` + `useStore`, never `createContext` / `useContext`.
- **`@alepha/ui/admin` is a separate sub-module** — importing from `@alepha/ui` inside admin code is correct, not a layering violation.

### Router and i18n

- **`useRouter<T>()` navigates with `router.push("pageName", { params })`** — there is no `router.navigate()`.
- **`useI18n().l()` returns `string | number`** — wrap in `String()` for string fields.
- **`I18nLocalizeOptions` has `date` and `number` only, no `time`** — for date+time pass a dayjs format string such as `"lll"` to `date`.
- **Name route params uniquely across the whole route table.** Two routes with different param names at the same path position silently lose the inner value.
- **`$route` never lives under `/api`** — it is the raw level below `$action`, does not prefix `/api`, and the `$action` dispatcher shadows anything under `/api/*` (404s). Root paths only.

### Repository / query API

- **`{ inArray: [...] }` for SQL `IN`**, not `{ in: [...] }`. See `FilterOperators.ts`.
- **`findMany()` accepts** `{ where, limit, offset, orderBy, groupBy, columns, distinct }` — there is no `sort` and no `size`.
- **For pagination use `paginate(query, { where }, { count: true })`**, which does accept `sort` / `size` on the query object.
- **Never pass `undefined` into a where-filter.** `where: { col: undefined }` throws `AlephaError`. It used to be dropped silently, producing a query with no `WHERE` at all — that was a real P0. Omit the key entirely for optional filters.
- **`.optional()` must go INSIDE `db.ref(...)`** — outside it, no foreign key is generated at all, silently, and the migration snapshot check cannot catch it.

### CLI internals (`packages/alepha/src/cli`)

- **Two Alepha instances.** `this.alepha` is the CLI's own container; `alepha` (passed as an argument) is the user's app container. Never confuse them — this is the most common CLI bug.
- **Build tasks live in `cli/tasks/`**, not `cli/build/`, named `BuildXxxTask` (e.g. `BuildCompressTask`).
- **No `index.ts` in `cli/tasks/`** — `index.ts` is reserved for module-level exports.
- **`run` (RunnerMethod) is passed to tasks as an argument**, not injected via DI. Tasks decide when or whether to call `run()` (e.g. skipping pre-render when there is nothing to prerender).
- **Use `FileSystemProvider` via `$inject`**, never raw `fs/promises`, so tasks stay testable with `MemoryFileSystemProvider`.

## Notes for AI Assistants

- **CRITICAL**: Don't commit unless the user explicitly tells you to. No `git commit`, `git add`, `git push`, or other history/index-modifying commands by default — leave changes uncommitted and describe them. The only always-allowed git command is `git mv` for renaming/moving files. When the user does authorize a commit, run `yarn v` first and fix any red before committing.
- Update docs/1-guides/ if you change any public API or behavior (docs/3-reference is auto generated from source code)
- The framework heavily uses TypeScript generics and decorators (`$` prefix indicates a primitive)
- All async operations should use `Alepha.create()` and proper lifecycle management
- HTTP client (`HttpClient`) has built-in request deduplication and caching
- Browser tests must use `.browser.spec.ts` extension to run in jsdom
- React hooks follow the pattern: `use` + noun (useAction, useClient, etc.)
- Services use dependency injection via `$inject()` decorator
- Event names follow pattern: `namespace:action:status`
- **IMPORTANT**: NEVER use the `private` keyword in class members. Use `protected` instead for all access control
- **IMPORTANT**: NEVER use `vi.mock()` or `vi.spyOn()` - use Alepha's service substitution with `.with()` and Memory providers instead
- **IMPORTANT**: NEVER use `window.confirm()` / `window.alert()` / `window.prompt()` in UI code. Use the imperative dialog API from `@alepha/ui/components/use-dialog/use-dialog`: `const dialog = useDialog();` then `await dialog.confirm({ title, description?, confirmLabel?, cancelLabel?, destructive? })` (returns `Promise<boolean>`), `dialog.alert(...)`, or `dialog.prompt(...)`. `<DialogProvider>` is already mounted in `apps/lore`'s `Layout.tsx`.
- **IMPORTANT**: NEVER use single-line JSDoc comments. Always use multi-line format:
  ```typescript
  // Bad
  /** This is a single-line comment */

  // Good
  /**
   * This is a multi-line comment.
   */
  ```
- **Package imports**: All 50+ core modules can be imported from the `alepha` package (e.g., `import { } from "alepha/security"`)
- Always use "git mv" for renaming files to preserve git history
- Tests can be co-located with source code as `*.spec.ts` files (not just in `__tests__` directories)
