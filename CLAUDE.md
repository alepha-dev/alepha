# CLAUDE.md

Alepha is a convention-driven TypeScript framework for end-to-end type-safe applications. Yarn workspaces monorepo: `packages/*` is the framework, `apps/*` the applications. Docs: https://alepha.dev/llms.txt

For verbose CLI output: `LOG_FORMAT=pretty LOG_LEVEL=trace yarn w @alepha/devtools build`.

## The workflow

⚠️ **CI is the gate. A green terminal is not.**

1. **Work in a worktree.** One epic, one worktree, one branch. Never edit the primary checkout: parallel sessions share it.
2. **Commit as you go, and name the quest.** Small commits, staged by explicit path (never `git add -A`), each naming its Lore quest as `#Q<n>` (see "Every commit belongs to a quest").
3. **Push the branch to verify.** Every branch triggers the full CI graph, about five minutes.
4. **When it is green, finish the branch.** Merge to main, push, delete the branch locally and on the remote, remove the worktree.

### Small edits skip the ceremony

A small edit goes straight to `main`: no worktree, no quest, no `#Q<n>`. Small means a few lines in one or two files, carrying no decision a later session would look for in Lore: a `.gitignore` entry, a typo, a comment, a sentence of this file. A reported bug fix, or anything you would want to explain, gets its quest however short. If you cannot tell, ask.

1. Read `git status` on the primary checkout first. If the file carries somebody else's uncommitted edit, use a worktree after all.
2. Run only the check that can see the change (see "Verifying"). A red CI run here lands on `main` itself.
3. Stage the path by name, commit, `git fetch`, check that `git log origin/main..main` lists only your commit, and push.

### Verifying

- `yarn v` (`yarn alepha verify`) is the **inner loop, not the gate**: install, `yarn copy` (generators, then lint), then typecheck and the five `check:*` audits in parallel, then `test` and `test:bun`. About 3 minutes. **It cannot catch a build failure, an SSR regression, or anything an e2e covers.**
  - Needs Docker running (postgres, redis, versitygw).
  - ⚠️ **It rewrites the generated docs, and fails until you stage them.** `yarn copy` regenerates `docs/framework/2-reference`, `docs/framework/3-packages` and every public package's `README.md` from the JSDoc, and `check:docs` refuses any that differs from the index. A JSDoc change is a two-part commit: review the pages, stage them, run again.
  - One run per machine across every worktree: a second `yarn v` queues, since both test lanes drive the one postgres on 15432. `ALEPHA_NO_EXCLUSIVE=1` bypasses the queue.
  - Skip it when it has nothing to read: nothing for a `.gitignore` line, `yarn oxfmt <file>` for markdown prose, plus `yarn check:docs` when the file is a guide or a README with code samples.
- **Pushing the branch** is the real gate: `checks`, `test` (x6), `e2e-apps`, `e2e-lore` (x6), `e2e-cli`, `docker` and `bay`, in parallel. There is no full local pipeline. A re-push cancels the previous run.
- `yarn v:go` runs `apps/bay`'s suite in a container (gofmt, vet, build, tests, cross-compile). **Run it when you touch `apps/bay`**: `yarn v` says nothing about Go, and `yarn w bay test` skips every `//go:build linux` file on macOS.
- `yarn clean` removes generated files and `packages/*/node_modules`, including the `dist` a following command may need. `yarn v` never runs it.
- Also: `yarn w <workspace> <command>` (one workspace), `yarn build` (tsdown), `yarn test` (Vitest), `yarn lint` (oxlint `--fix`, then oxfmt), `yarn typecheck`.

**After a code change: `yarn v`, then push and read the CI run.** Fix a `yarn v` failure before pushing. A green `yarn v` is never reported as "verified". Inside one package, `yarn w <workspace> typecheck` and `yarn w <workspace> test` are cheaper.

### Workspace checks

`yarn check:deps` (depcheck), `check:i18n`, `check:migrations`, `check:docs` (`apps/docs/scripts/check-docs.ts`: doc code samples against the source, generated pages against the index, meaningful only after `yarn copy`) and `check:conventions` (`scripts/check-conventions.ts`). The first four fan out to every workspace exposing the script. A new cross-app check follows the same shape: workspace script, root aggregator, and a line in the `verify` command in `scripts/commands.ts`.

### One artifact, N runtimes

- Four commands: `alepha build --runtime node,workerd` (one `dist/`, two slices), `alepha compile --out my-app` (a binary, from the bun slice), `alepha pack` (`<project>-<tag>.tar.zst`), `alepha image --tag` (a container image).
- `dist/` holds `index.<runtime>.js` per slice over `server/<runtime>/`, plus `public/` and `manifest.json`. There is no `index.js`: the manifest is the discovery mechanism.
- ⚠️ **Declared order is the decision.** The first runtime is the primary: `manifest.runtime`, `dist/package.json`'s `main`, and what a deployer spawns.
- ⚠️ **`--target` is gone.** A `workerd` slice writes the Cloudflare config, `runtime: ["static"]` makes a static site, Docker is `alepha image`.
- The archive root is the contents, not a `dist/` wrapper, and it is zstd with a pinned `windowLog` (25, so 32 MiB). At the default window two slices do not dedup.
- `alepha image` writes its Dockerfile into the app directory, to be committed, and builds with `dist/` as the context. It needs the docker CLI.
- `image:` is a top-level config key, not `build.docker`. `build.cloudflare` stays under `build`.

## Architecture

- Primitives carry a `$` prefix (`$action`, `$entity`, `$repository`), services are wired by the DI container (`$inject()`), event names follow `namespace:action:status`, React hooks are `use` + noun.
- **`alepha`** (`packages/alepha/src/`) exports 50+ sub-modules, imported as `alepha/<module>` (`alepha/server`, `alepha/api/users`).
- **`@alepha/ui`**: Base UI + Tailwind components in seventeen modules, `src/<module>/` with an `index.ts` barrel each. `@alepha/ui` itself is `src/core`; the subpaths are `form`, `settings`, `table`, `tree`, `markdown`, `shell`, `auth`, `account`, `admin`, `organizations`, the opt-in wrappers `chart`, `command`, `calendar`, `otp`, `resizable`, and `i18n/fr`. Edited in place, no registry. `check:conventions` guards the map: `core` imports no other module, `organizations` only `core`, `form`, `table`, `settings`, the wrappers and `i18n/fr` only `core`, and there is no cycle.
- **`@alepha/lore`**: the reporting half of a sigil. An app sends page views, Web Vitals and errors to `SIGIL_SINK` (default `https://lore.alepha.dev`), authenticated by `SIGIL_KEY`, shaped `sg_<project>_<secret>`: the only required variable and the only secret. `SIGIL_CONFIG` is optional switches.
- Others: `@alepha/devtools`, `@alepha/commerce`, `@alepha/payments-stripe`, `@alepha/discord`, `@alepha/protobuf`, `create-alepha`.

### Lore (`apps/lore`)

The only public Alepha application, at `lore.alepha.dev`, kept here to **dogfood the framework**: when working on it, `packages/alepha` and `packages/@alepha/ui` are fair game, edited in place and shipped in the same commit.

`main` auto-deploys to Cloudflare with no human gate: **Deploy latest** (`deploy-latest.yml`) fires once **Verify** (`verify.yml`) succeeds on a push to `main`. A Verify cancelled by a newer push leaves that commit undeployed until the next green push. Lore migrations (`apps/lore/migrations/sqlite/`) target D1, which has a cascade-on-DROP-TABLE quirk: read "Migration safety on D1" in `apps/lore/CLAUDE.md` before pushing anything that touches them.

### Lore MCP: the planning memory

Decisions, plans and bug reports live in the **Alepha project, id `1`**. Projects `2` and `64` are empty shells from the 2026-08-18 merge: never file there. A reference above 1000 in an older note was a Lore number (`n - 1000`); shop feedback carries +2000.

- Before a non-trivial change, orient with `project_context` (project `1`), then `folio_get` the relevant folios.
- **Folios record decisions, quests record work.** Write a folio (`folio_create` with a good `summary`) whenever a session produces a non-obvious decision or design note.

#### Every commit belongs to a quest

A session that commits works under a quest, named or not, a session started from a suggested task included. The one exception is a small edit.

1. **Find the quest or file it**: `quest_list` / `quest_get`, else `quest_create` with `accept: true`, a title saying what changes, a description saying why, and an existing `area`.
2. **Accept it before the first commit** (`quest_accept`).
3. **Name it in every commit** as `#Q<n>` and record each sha with `quest_commit_add`.
4. **Complete it when the work lands** (`quest_complete`), noting what shipped and what was left out.

One piece of work is one quest, never a quest per commit. **Before raising a background task** (`spawn_task`), file its quest and put its `#Q<n>` in the task's prompt, so the session that takes it accepts that quest instead of filing a second one.

#### Filing folios

⚠️ **Run `directory_list` before filing** and pass `directory_shortId` to `folio_create`: the tree has been reorganised twice. **Top-level directories are subjects, not document types**: `alepha` (`packages/alepha` and `@alepha/ui`), `alepha-lore`, `alepha-bay`, `alepha-platform` (the deploy chain), `alepha-commerce` (with `apps/examples/shop`), plus `reviews` (dated audits) and `trash`. The kind of document goes in the `summary`. A subject may group inside itself (`alepha-lore/ideas`, `alepha-commerce/specs`), but there is never a top-level `specs/` or `plans/`. Older notes naming `framework`, `lore`, `bay`, `platform`, `commerce` or `archive` as a directory predate the 2026-09-06 rename.

**Lifecycle.** When work ships, the outcome folio survives and the spec moves to `trash`. `folio_delete` is permanent, so nothing is deleted outright, and `trash` is never emptied without being asked.

⚠️ **superpowers plans and specs are also persisted as folios.** `docs/superpowers/` is gitignored, so a plan there dies with its worktree. File it under its subject with a `summary` naming it a plan or a spec: what is being built, the constraints, the decisions taken with their reasons. Update it when the plan changes materially, and mark it done or superseded when the work ships.

## Testing

Vitest with globals. Specs live in `__tests__/` or co-located as `*.spec.ts`. `*.browser.spec.ts(x)` runs under jsdom, everything else under node.

- All: `yarn test`. One workspace: `yarn w alepha test`. One project from the root: `yarn alepha test --project alepha` (comma-separated, globs). Filtered: `yarn w alepha vitest run <pattern>`. Coverage: `yarn vitest run --coverage`.

### One Vitest project per workspace

Every workspace holding specs owns a `vitest.config.ts` calling `workspaceProjects` from `scripts/vitest.projects.ts`; the root config imports and spreads them, so `yarn test` is the union and `yarn w <workspace> test` exactly one. The helper holds the shared settings (service env, Paris timezone, timeout, `globals`, jsdom via `jsdomProject` from `alepha/testing/vitest`) and turns the workspace's tsconfig `paths` into aliases, skipping a path prefixed by the workspace's own package name. Enforced by `check:conventions`:

- A workspace with spec files owns a `vitest.config.ts`, and the root config imports it.
- `jsdom: true` is passed if and only if the workspace has `*.browser.spec.*` files. It yields two projects, `<name>` and `<name>:jsdom`, selected together with `--project '<name>*'`.
- `apps/e2e-cli` is the single exemption: own config, out of the root run, driven by `yarn e2e-cli`.

⚠️ Project entries stay FLAT. A project config declaring `projects` of its own is silently collapsed into one project under the parent's settings.

### Ports

| band                        | owner                                                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3300-3399`                 | dev servers, `dev.port` in `alepha.config.ts`: docs 3302, lore 3303, shop 3305, totp 3307, ui 3308, devtools 3310 (its Vite config), ssr 3311, `~/git/loom` 3312 |
| `5173+`                     | dev servers with no `dev.port`, and `alepha dev` in multi-app mode (`5173 + index` via `SERVER_PORT`, which **overrides `dev.port`**)                            |
| `4300-4999`                 | **e2e, and nothing else**                                                                                                                                        |
| `15432` / `16379` / `19090` | `compose.yml` test services (postgres / redis / versitygw)                                                                                                       |

⚠️ `check:conventions` reads this table: every dev port must appear in the `3300-3399` row.

Every Playwright config takes its port from `e2ePort("<app>")` in `scripts/playwright.port.ts`, which binds this repository's registry (`E2E_SLOTS`) to `createE2ePortAllocator` from `alepha/testing/playwright`. The argument is the app name, never a port. Port logic goes in the package, suite names in `E2E_SLOTS`, and a new suite needs a slot or it will not typecheck. The slot derives from the checkout path, so two worktrees never collide, and is bind-tested. `reuseExistingServer` is `false` everywhere: an e2e run must never adopt a dev server. `E2E_PORT` overrides it all.

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
- **One schema per file.** The one exemption is a table filter's `schema`, inline in a `DataTable`'s `filters.fields` record. A schema naming a domain type is imported, never redeclared, and only from a module the browser can load: a `schemas/` file or a UI constant, never an entity or a server barrel (hence `orderStatusSchema.ts` in `@alepha/commerce`).
- Rename files with `git mv`.
- A public API or behavior change updates `docs/framework/1-guides/`. `2-reference` and `3-packages` are generated: fix the JSDoc, never those files.

### Typing traps

- **Schemas are Zod, imported as `z` from `"alepha"`.** There is no `t` export: anything saying `t.text()` is pre-migration and wrong.
- **`z.any()` is not valid** for a `$route` request or response body. Use `z.record(z.text(), z.any())`, with `as any` on the return value.
- **`schema.response` is what serializes.** A field missing from the response schema is dropped silently.
- **`this.alepha.env.*` returns `string | number | boolean`**: coerce with `String()` / `Number()`.
- **`HttpClient.fetch()` without a `schema` returns `{ data: {} }`**: cast `res.data as any` for untyped endpoints.
- **Never augment zod's `GlobalMeta`**: it explodes the type graph. Use `satisfies SchemaControlFn` locally.

### React components

⚠️ In `packages/@alepha/ui/src`, `check:conventions` enforces the component shape, one component per file and the context rule. Everywhere else, apps included, they are enforced by review.

- **One component per file.** An extracted inner `Header` of `ParentComponent.tsx` becomes `ParentComponentHeader.tsx`. The exemption is a compound primitive family (`UI_COMPOUND_FILES` in the script, such as `src/core/DropdownMenu.tsx`).
- **File order:** props interface, component, the rest.
- **Arrow functions, never `function`**, and **props never destructured in the parameter list**: `const MyComponent = (props: MyComponentProps) => {}`, with `MyComponentProps` a named exported interface in the same file.
- **No React Context for anything app-wide**: use `$atom` + `useStore`. The exemption is state scoped to a subtree (the parts of one compound component, or what a provider gives its descendants), since an `$atom` holds one value per container. Each such `createContext` carries the marker `Context exemption:` and its reason in the comment directly above it.
- **Inside `@alepha/ui`, imports are relative and name a concrete file** (`../core/Button.tsx`), never `@alepha/ui` or a module's `index.ts`. Outside it, import from the module subpath (`@alepha/ui/admin`), never a file inside. `check:conventions` refuses both.
- **Always a `Control*` for a field** (`<Control select>` / `<ControlSelect>`), never a hand-built picker. `Control` binds to a form field, so a picker with local state becomes a one-field `useForm`: `initialValues` for what the server says, `onChange` for a control that saves on change, `useFormValues` where a `useState` was read.
- **Never `window.confirm()` / `alert()` / `prompt()`**: `const dialog = useDialog()`, then `await dialog.confirm({ title, description?, confirmLabel?, cancelLabel?, destructive? })` (a `Promise<boolean>`), `dialog.alert(...)` or `dialog.prompt(...)`. Lore's `Layout.tsx` mounts `<DialogProvider>`.

### Calling the API from React

⚠️ No `check:conventions` rule enforces this and none is coming (#E59): this section is the guard. A change that moves one of these rules updates it in the same commit.

- **Every call on a `useClient()` result goes through `useQuery` (a read), `useAction` (a write), a `useForm` handler, or a `DataTable`'s `fetch` / `summary.fetch`.** Never a `useEffect` with an `alive` flag, never an async function with its own `try/catch` and toast.
- **One `ActionErrorToaster` sits at the app root** (Lore's and the shop's `Layout.tsx`; a non-`embedded` `AppShell` mounts its own), so a failure is never toasted by hand. A failure that must stay quiet, or that the page shows itself, passes `onError`, which marks it `handled`. A `FormValidationError` with a field `path` is handled already.
- ⚠️ **`run()` drops a call made while one is in flight, and resolves `undefined` on failure.** Disable every control of the action on `loading`, page-wide rather than per row, and put follow-ups inside the handler: `await save.run(); close()` closes the dialog on a failure.
- ⚠️ **`useAction` appends `{ signal }` as the handler's last argument.** No optional or defaulted trailing parameter: it would receive `{ signal }`, and TypeScript does not catch it. Make it required or take one object, and type the hook explicitly (`useAction<[id: string], boolean>`).
- **An optimistic update restores its snapshot in the handler's `catch` and rethrows.** `onError` never saw the snapshot, and the rethrow is what reports the failure.
- **A read that a write refreshes has a key**: kebab-case resource, then project id, then anything narrower (`["project-users", projectId]`). The write declares `invalidates`, or calls `useQueryClient().invalidate` when the key needs a handler-only argument.
- **A wrapper hook that owns an interaction returns its verbs as `useAction` runs** (`useInviteOrganizationMember`, `usePanier`): `true` when it happened, `false` when the user backed out or a local check refused, `undefined` when the request failed. **A hook whose functions other handlers compose keeps rejecting** (`useQuestMutations`); its callers run it inside their own `useAction`.
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

### CLI internals (`packages/alepha/src/cli`)

- **Two Alepha instances.** `this.alepha` is the CLI's own container; the `alepha` passed as an argument is the user's app. Confusing them is the most common CLI bug.
- **Build tasks live in `cli/core/tasks/`**, named `BuildXxxTask`, with no `index.ts` there.
- **`run` (RunnerMethod) is passed to tasks as an argument**, not injected: a task decides whether to call it.
- **`FileSystemProvider` via `$inject`**, never raw `fs/promises`, so tasks stay testable with `MemoryFileSystemProvider`.
