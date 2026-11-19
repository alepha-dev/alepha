# AGENTS.md: @lore/build

**Build**, Lore's fourth pillar (#E162, design folio #F1500): the code a project holds. It sits between planning and shipping: git repositories now, CI and pull requests later. It imports `@lore/core` only (`check:conventions`, `scripts/lore-package-graph.ts`), and reaches the other modules only through a core registry or a core link. Read the repository's `AGENTS.md` first, then `packages/@lore/core/AGENTS.md`: the barrels, the registries this package fills, and the conventions every package shares.

## Names

The pillar is **Build**: the package `@lore/build`, its modules `LoreBuildApi` and `LoreBuildMcp`, and the capability key `build`, off for every project by default. The thing it holds keeps the name **code**: the permissions `code:read`, `code:write` and `code:admin` (group `code`), the CLI `lore code ...`, the MCP tools `code_*` and the tables `code_*`. "Build" also names `lore apps build` and `alepha build`; they live in other namespaces.

## Permissions

- `code:read` (clone, fetch, list) is in every default rank, Viewer included.
- `code:write` (push) is in the Member default: a member may push.
- `code:admin` (create and delete a repository) is an Admin's. A `lore login` holds it (`LoreOAuthScopes.CLI_ONLY_PERMISSIONS`, #Q3965); an MCP token never does (`PARTIAL_GROUPS` gives it `code:read` and `code:write` only).

## Layout

`api/`, `mcp/`, `web/`, `schemas/` and `testing/`, as the other packages. `web/` holds Quality's existing pages only (the Reports Quality tab, moved from Ship): #E162 draws no page for code.

## Routes

| Path                            | Route name       | Page (lazy)                                 | Notes                                                                                                                                                                                                    |
| ------------------------------- | ---------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/:projectSlug/reports/quality` | `reportsQuality` | `project/reports/ReportsQuality.client.tsx` | Coverage and test totals pushed by CI (#Q3070), moved from Ship with its name and URL. The only Reports tab whose data is INGESTED, hence its empty state. Shown with `build`; reads `getReportsQuality` |

## Repositories (#E162)

- **`code_repositories`** holds what Lore knows of a repository (slug, default branch, `backendRef`); the bytes live in the runtime's **`GitBackend`**, chosen in `LoreBuildApi.register`: `ArtifactsGitBackend` on the Worker (`isServerless()`, binding `ARTIFACTS`, namespace `lore-production` in `apps/lore/alepha.config.ts`), `LocalGitBackend` everywhere else (bare repositories under `${DATA_DIR}/git/<projectId>/<repoId>.git`, the `git` binary, which the image installs).
- **Named by id, never by slug**: `backendRef` is `<projectId>-<repoId>` on Artifacts and `<projectId>/<repoId>` on disk, set once at creation. A deleted Artifacts name cannot be reused for a while (folio #F1527), and a merge moves the row without touching the backend.
- **No cascade on `projectId`** (`restrict`, spelled out because `db.ref` cascades by default): a D1 rebuild of `projects` must never wipe rows that name backend repositories. `BuildProjectDeletion` deletes them explicitly, backend first; `BuildProjectMerge` moves them, refusing two under one slug.
- **Artifacts tokens are cached** per repository and scope for 10 minutes (minted for 15): minting costs 100 to 125 ms.
- **Limits** are core's `ProjectLimits`: `maxRepositoriesPerProject` (20) and `maxRepositorySizeMb` (1024, checked where the backend can measure).
- The specs run `LocalGitBackend` in a temporary `DATA_DIR` with the real `git`. `test/artifacts-contract.ts` is the contract test against a real namespace, run by hand with an Artifacts token, never by Verify.

## git smart HTTP (#Q3932)

- **Six `$route`s with static tails** in `GitHttpController`: `/:repo/{info/refs,git-upload-pack,git-receive-pack}` (`/<project>.git`, the repository named like its project) and the same under `/:project/:repo/`. Each answers 404 unless the last param ends in `.git`; no body schema, so the body parser leaves the pack stream alone. `apps/lore/test/git-routes.spec.ts` pins them beside the pages.
- **Auth** (`GitAccessService`): the Basic password, whatever the username, is resolved as a bearer by the realm's resolvers (an API key or an OAuth access token). No credential: 401 with `WWW-Authenticate` before any lookup. Not a member: 404. No `code:read` (upload-pack) or `code:write` (receive-pack) in the token's scope or the rank: 403. Build off: 404 on a read, 400 on a write.
- **Receive-pack is read before the backend** (`GitReceivePack`): the ref commands, capabilities and push options ahead of the pack, buffered and replayed. Deleting the default branch, or pushing to a repository over `maxRepositorySizeMb` (disk only), is refused with a `report-status` git prints. Non-fast-forward refusal is #Q3953, not here.
- **Backends serve** (`GitBackend.serve`): Artifacts proxies to `info.remote` with the cached repo token, streaming both bodies; Node spawns `git upload-pack|receive-pack --stateless-rpc`, writes the `# service=` line unless the client speaks v2, passes a validated `Git-Protocol` as `GIT_PROTOCOL`, and kills the child when the request aborts. A gzipped request body is inflated by the route first.
- **After a push** (`CodePushRecorder`, #Q3945): the route wraps a 200 receive-pack response in a pass-through stream that keeps a copy (1 MiB at most) and, at its end, reads the `report-status` (`GitReceivePack.acceptedRefs`, side-band demuxed). For each `refs/heads/*` update the backend reported `ok`, with an old and a new id, it lists the commits (`GitBackend.commits`: `git log old..new` on disk, the binding's first-parent `log` on Artifacts, nothing when over 1,000 or when the old id is not met) and hands them to core's `CommitReferenceRegistry`, which Plan fills: a commit naming `#Q<n>` lands on that quest, `by` the pusher, deduped by sha prefix. A branch's creation and an import (`lore-import`) record no commit. Every accepted push writes a `code:push` activity row (coalesced over 5 minutes). Best effort: a failure is logged, never turned into a red push.

## CLI and MCP (#Q3934)

- `code_repo_list|create|delete` (`CodeTools`) are `lore code repo list|create|delete`, on the same actions; create and delete answer 403 to every MCP token (no `code:admin`), and work from the CLI.
- The CLI is git's credential helper (`LoreGitCredentials`, `lore git-credential`): `lore login`, `lore clone` and `lore code remote --add` install it per host behind an empty `helper =` entry, so a keychain helper never stores a short-lived token. `apps/e2e/cli/code.e2e.spec.ts` proves it from a clean HOME with a storing helper configured.

## Import (#Q3935)

- `lore code import` (`LoreCodeImport` in `@alepha/lore`) slices on Artifacts (the repository answers `backend: "artifacts"`) and pushes in one go on a local backend. A slice is at most 40,000 new objects and 60 MiB, found by counting candidate ranges (`rev-list --count --objects`, `--disk-usage`), never by pushing; a refusal as too big halves the budget; a merge over the budget alone goes through `refs/lore-import/<n>` first. Measured on this repository's `main` against a local bare remote: 12 pushes, 16 s, HEAD matching.
- Every import push carries the push option `lore-import`. Lore advertises `push-options` on every receive-pack advertisement and strips the options before the backend sees the push (`GitReceivePack`), so the marker works on Artifacts whatever it advertises.

## Quality (moved from Ship, #E162)

- **A push is never gated**: `QualityController.pushQualityRun` answers whatever the switches say (`capability-gate.spec.ts`). What `build` gates is the Reports tab (`BuildShell`), the tiles (`BuildDashboardMetrics`, `QualityNumericCatalog`), the event `coverage.dropped` (`BuildProjectEvents`) and the `quality` permission group.
- **Thresholds are core's** (`ProjectThresholds`, `project_thresholds`): Build checks coverage on a push on `main` (`CoverageThreshold`), Ship open errors hourly. The coverage target and alert stay on Ship's settings page.
- **Tags on the curve** come from Ship's artifacts through core's `BuiltTagRegistry`, which Ship fills (`DeployBuiltTags`).
- Build's own merge step moves `quality_runs` (`BuildProjectMerge`) and its summary line is coverage (`BuildReportsSummary`).

## Tests

`test/` holds the specs whose subject is Build, booting `LoreBuildApi` (and `LoreBuildMcp`) alone through `@lore/build/testing` (`BuildTestEntities`). A spec that needs another pillar is a scenario and lives in `apps/lore/test`.
