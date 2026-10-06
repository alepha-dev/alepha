# CLAUDE.md

**Alepha Lore**: the planning memory, telemetry sink and deploy chain for Alepha applications, at `lore.alepha.dev`. This repository holds the app (`apps/lore`, read `apps/lore/CLAUDE.md` before working on it), its four private modules (`packages/@lore/*`, see the layout below), its CLI and client (`packages/@alepha/lore`, published to npm), and the end-to-end suites that drive built artefacts (`apps/e2e-cli`).

It left the Alepha monorepo on 2026-10-01 (epic #E72 of the Alepha project) with its history. The framework is developed in `github.com/alepha-dev/alepha`; Bay in `github.com/alepha-dev/bay`.

## Layout: packages are modules, apps are executables

`packages/*` holds Alepha modules; `apps/*` holds executables. Lore lives in four private packages, loaded as source with no build step, and `apps/lore` is the executable that composes them (#E75, folio #F1356). Each package documents itself in its own `CLAUDE.md`, read before working on it: [`@lore/core`](packages/@lore/core/CLAUDE.md), [`@lore/work`](packages/@lore/work/CLAUDE.md), [`@lore/knowledge`](packages/@lore/knowledge/CLAUDE.md), [`@lore/deploy`](packages/@lore/deploy/CLAUDE.md).

| package           | is               | owns                                                                                                                                                                                     |
| ----------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@lore/core`      | the glue         | projects, capabilities, ranks and permissions, notifications, audits, the resource registry and its link graph, search, dashboard, reports, agent prompts, the web shell, every registry |
| `@lore/work`      | Lore as Jira     | quests, epics, releases, areas, kanban, roadmap, feedback                                                                                                                                |
| `@lore/knowledge` | Lore as Obsidian | folios, directories, attachments, revisions, names                                                                                                                                       |
| `@lore/deploy`    | Lore as Vercel   | apps, telemetry, deployments, estates                                                                                                                                                    |

Each package exports `./api`, `./mcp`, `./web` and `./schemas` (core also `./testing`), and declares three modules, `Lore<Pkg>Api`, `Lore<Pkg>Mcp` and `Lore<Pkg>Web`, registered by `apps/lore`'s entries after every entry-level substitution, core first; the entries are the only place they meet. Scenario specs boot them the same way, through `bootLore()` in `apps/lore/test/fixtures/bootLore.ts`. `./web` is registered by BOTH entries.

⚠️ **The rule** (`check:conventions`, graph table in `scripts/lore-package-graph.ts`):

```
core <- work
core <- knowledge
core <- deploy
```

- A feature module never imports another. A feature spanning two goes through a core registry or a core link (an epic files folios, a blight is forwarded to a quest, a release lists its artifacts).
- `./web` imports another package's `./api` or `./mcp` as `import type` only; runtime values come from `./schemas` or `./web`.
- No deep import past `exports`, no import of `apps/*` (nor of `lore`), no `@/` inside a package.

## The framework is vendored

`.vendor/alepha` and `.vendor/@alepha/ui` are the framework's `main`, copied by `alepha vendor sync` and committed (`.vendor/vendor.json` records the commit). They are yarn workspaces, so `alepha` and `@alepha/ui` resolve to them, as source.

- **Never edit `.vendor/` here.** A framework change is made in `alepha-dev/alepha`, pushed to its `main`, then brought in with `yarn vendor:sync` (it refuses when `.vendor/` was edited locally). Alepha has near-zero training data: read `.vendor/alepha/src` as the authority on its API.
- **After a sync, republish `@alepha/lore`** when the sigil or the client touched a framework API that moved: hosts run the sigil on their own `alepha`.
- `vendor sync` clones from a git remote, so it only sees COMMITTED framework work.

## The workflow

⚠️ **CI is the gate. A green terminal is not.**

1. **Work in a worktree** for anything beyond a small edit. One epic, one worktree, one branch.
2. **Commit as you go, and name the quest.** Small commits, staged by explicit path (never `git add -A`), each naming its Lore quest as `#Q<n>`, the sha recorded with `quest_commit_add`.
3. **Push the branch to verify.** Every branch runs `Verify` (`checks`, `test` x2, `e2e-lore` x6, `e2e-cli`, `docker`).
4. **When it is green, finish the branch**: merge to main, push, delete it locally and on the remote, remove the worktree.

A small edit (a few lines, no decision anyone would look for later) goes straight to `main` with no quest.

⚠️ **`main` deploys to production with no human gate.** `Deploy latest` runs `alepha platform up` on `lore-production` once `Verify` succeeds on a push to `main`. Lore migrations target D1, which cascade-wipes children on `DROP TABLE`: read "Migration safety on D1" in `apps/lore/CLAUDE.md` before pushing one.

### Verifying

- `yarn v` (`yarn alepha verify`) runs what CI runs, the Docker image aside: install, lint, then typecheck and the audits (`check:deps`, `check:conventions`, `check:i18n`, `check:migrations`), `yarn test`, `yarn build`, `yarn e2e` and `yarn e2e-cli`. `e2e-cli` needs a Bay checkout and Go: `BAY_DIR`, else `.bay`, else a sibling `../bay`; `yarn v` refuses up front when none exists. No service is needed: every spec runs on SQLite.
- `yarn v --fast` is the **inner loop**: it stops after `yarn test`, so it cannot catch a build failure, an SSR regression or anything an e2e covers.
- `yarn w lore test` / `yarn w @alepha/lore test` for one workspace, `yarn w lore vitest run <pattern>` for one file.
- `yarn w lore e2e` needs `yarn w lore build` first; `yarn e2e-cli` needs `yarn build` and the Bay checkout above.

### Releasing

`Release` (`workflow_dispatch`) bumps `apps/lore` and `@alepha/lore` together, publishes the package to npm (trusted publishing), pushes `ghcr.io/alepha-dev/lore`, and publishes the Lore release of the same tag. The changelog is Lore's own release feature: the quests attached to the release in the Lore project.

## Lore MCP: the planning memory

Decisions, plans and bug reports live in the Lore project **Lore** (`https://lore.alepha.dev/lore`, project id `74`). Framework work stays in project `Alepha` (id `1`), Bay's in project `Bay` (id `75`).

- Before a non-trivial change, orient with `project_context` (project `74`), then `folio_get` the relevant folios.
- **Folios record decisions, quests record work.** Write a folio whenever a session produces a non-obvious decision.
- **Every commit belongs to a quest**, a small edit excepted: find or file it (`quest_create` with an existing `area`), accept it before the first commit, name it as `#Q<n>` in every commit, record each sha with `quest_commit_add`, complete it when the work lands.

## Testing

Vitest with globals. Specs live in `__tests__/` or `test/`, or co-located as `*.spec.ts`. `*.browser.spec.ts(x)` runs under jsdom, everything else under node. Every workspace with specs owns a `vitest.config.ts` calling `workspaceProjects` from `scripts/vitest.projects.ts`, and the root `vitest.config.ts` spreads them.

E2E ports come from `e2ePort` / `e2eWorkerPort` in `scripts/playwright.port.ts` (the 4300-4999 band, derived from the checkout path, bind-tested). Lore's dev server is on 3303.

### Patterns

- `Alepha.create()` handles start/stop in tests. Arrange-Act-Assert, descriptive names, `expect` taken from the test fixture.
- **`describe` + `it`, never a bare `test()` or `it()` at the top level** (`check:conventions`; `e2e/` is exempt, Playwright has no `it`).
- Errors: `expect().toThrow()` and `expect().rejects.toThrow()`. Never `toThrowError` (`check:conventions`).
- **NEVER `vi.mock()` or `vi.spyOn()`.** Substitute services instead:

```typescript
const alepha = Alepha.create()
  .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
  .with({ provide: ShellProvider, use: MemoryShellProvider });
const fs = alepha.inject(MemoryFileSystemProvider);
expect(fs.wasWritten("/path/file.ts")).toBe(true); // also wasWrittenMatching, wasDeleted
expect(alepha.inject(MemoryShellProvider).wasCalled("yarn install")).toBe(true);
```

- Memory providers exist for file system, shell, queue, topic, lock, SMS, file storage and cache.
- To reach a protected method, subclass it in the spec: `class TestCliProvider extends CliProvider { public testParseFlags = this.parseFlags.bind(this); }`.
- CLI commands: `await alepha.inject(CliProvider).run(cmd.init, { argv: "--react", root: "/project" })`.

## Code conventions

Not obvious from the code, so read them before writing any.

### Core rules

- **Never `Date.now()`**: inject `DateTimeProvider` and call `this.dateTime.nowMillis()`, which makes time testable via `travel()` / `pause()`. Not available inside `alepha/core` or `alepha/datetime`. `travel()` also fires every `$job` cron in the container: assert end state, not call counts.
- **Never throw `Error`**: always `AlephaError` (from `"alepha"`).
- **No code outside classes**: no standalone functions or constants in service files, so everything stays substitutable.
- **Never `private`**, always `protected`. No `_` prefix on class members.
- **Never a single-line JSDoc** (`/** text */`): always the multi-line form.
- **One schema per file.** The one exemption is a table filter's `schema`, inline in a `DataTable`'s `filters.fields` record. A schema naming a domain type is imported, never redeclared, and only from a module the browser can load: a `schemas/` file or a UI constant, never an entity or a server barrel.
- Rename files with `git mv`.

### Typing traps

- **Schemas are Zod, imported as `z` from `"alepha"`.** There is no `t` export: anything saying `t.text()` is pre-migration and wrong.
- **`z.any()` is not valid** for a `$route` request or response body. Use `z.record(z.text(), z.any())`, with `as any` on the return value.
- **`schema.response` is what serializes.** A field missing from the response schema is dropped silently.
- **`this.alepha.env.*` returns `string | number | boolean`**: coerce with `String()` / `Number()`.
- **`HttpClient.fetch()` without a `schema` returns `{ data: {} }`**: cast `res.data as any` for untyped endpoints.
- **Never augment zod's `GlobalMeta`**: it explodes the type graph. Use `satisfies SchemaControlFn` locally.

### React components

⚠️ These are enforced by review: `check:conventions` checks none of them here.

- **One component per file.** An extracted inner `Header` of `ParentComponent.tsx` becomes `ParentComponentHeader.tsx`. The exemption is a compound family whose parts only make sense together.
- **File order:** props interface, component, the rest.
- **Arrow functions, never `function`**, and **props never destructured in the parameter list**: `const MyComponent = (props: MyComponentProps) => {}`, with `MyComponentProps` a named exported interface in the same file.
- **No React Context for anything app-wide**: use `$atom` + `useStore`. The exemption is state scoped to a subtree (the parts of one compound component, or what a provider gives its descendants), since an `$atom` holds one value per container. Each such `createContext` carries the marker `Context exemption:` and its reason in the comment directly above it.
- **Import `@alepha/ui` from its module subpath** (`@alepha/ui/admin`), never a file inside it.
- **Always a `Control*` for a field** (`<Control select>` / `<ControlSelect>`), never a hand-built picker. `Control` binds to a form field, so a picker with local state becomes a one-field `useForm`: `initialValues` for what the server says, `onChange` for a control that saves on change, `useFormValues` where a `useState` was read.
- **Never `window.confirm()` / `alert()` / `prompt()`**: `const dialog = useDialog()`, then `await dialog.confirm({ title, description?, confirmLabel?, cancelLabel?, destructive? })` (a `Promise<boolean>`), `dialog.alert(...)` or `dialog.prompt(...)`. Lore's `Layout.tsx` mounts `<DialogProvider>`.

### Calling the API from React

⚠️ No `check:conventions` rule enforces this and none is coming (#E59): this section is the guard. A change that moves one of these rules updates it in the same commit.

- **Every call on a `useClient()` result goes through `useQuery` (a read), `useAction` (a write), a `useForm` handler, or a `DataTable`'s `fetch` / `summary.fetch`.** Never a `useEffect` with an `alive` flag, never an async function with its own `try/catch` and toast.
- **One `ActionErrorToaster` sits at the app root** (Lore's `Layout.tsx`; a non-`embedded` `AppShell` mounts its own), so a failure is never toasted by hand. A failure that must stay quiet, or that the page shows itself, passes `onError`, which marks it `handled`. A `FormValidationError` with a field `path` is handled already.
- ⚠️ **`run()` drops a call made while one is in flight, and resolves `undefined` on failure.** Disable every control of the action on `loading`, page-wide rather than per row, and put follow-ups inside the handler: `await save.run(); close()` closes the dialog on a failure.
- ⚠️ **`useAction` appends `{ signal }` as the handler's last argument.** No optional or defaulted trailing parameter: it would receive `{ signal }`, and TypeScript does not catch it. Make it required or take one object, and type the hook explicitly (`useAction<[id: string], boolean>`).
- **An optimistic update restores its snapshot in the handler's `catch` and rethrows.** `onError` never saw the snapshot, and the rethrow is what reports the failure.
- **A read that a write refreshes has a key**: kebab-case resource, then project id, then anything narrower (`["project-users", projectId]`). The write declares `invalidates`, or calls `useQueryClient().invalidate` when the key needs a handler-only argument.
- **A wrapper hook that owns an interaction returns its verbs as `useAction` runs** (`useInviteOrganizationMember`): `true` when it happened, `false` when the user backed out or a local check refused, `undefined` when the request failed. **A hook whose functions other handlers compose keeps rejecting** (`useQuestMutations`); its callers run it inside their own `useAction`.
- **A callback whose promise an awaiting consumer needs stays a plain function** (markdown upload hooks, an analytics transport), with its reason in a comment.
- **Never `catch (x: any)`.** Read `.message` through `instanceof Error`. The toast says `error.message`, never a translated "something went wrong" in front of it.

### Router and i18n

- **`router.push("pageName", { params })`** on `useRouter<T>()`. There is no `router.navigate()`.
- **`tr()` and `l()` both return `string`: never wrap either in `String()`.** A helper taking `tr` types it `(key: …) => string` or `I18nProvider<any, any>["tr"]`.
- **`I18nLocalizeOptions` has `date` and `number` only, no `time`**: for date+time pass a dayjs format such as `"lll"` to `date`.
- **`$route` never lives under `/api`**: the `$action` dispatcher shadows `/api/*` (404s). Root paths only.

### Repository / query API

- **`{ inArray: [...] }` for SQL `IN`**, not `{ in: [...] }` (`FilterOperators.ts`).
- **`findMany()` accepts** `{ where, limit, offset, orderBy, groupBy, columns, distinct }`: no `sort`, no `size`. **Pagination is `paginate(query, { where }, { count: true })`**, whose query object does take `sort` / `size`.
- **Never pass `undefined` into a where-filter**: `where: { col: undefined }` throws `AlephaError`. Omit the key for an optional filter.
- **`.optional()` goes INSIDE `db.ref(...)`**: outside it no foreign key is generated, silently, and the migration check cannot catch it.
