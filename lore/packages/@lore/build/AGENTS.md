# AGENTS.md: @lore/build

**Build**, Lore's fourth pillar (#E162, design folio #F1500): the code a project holds. It sits between planning and shipping: git repositories now, CI and pull requests later. It imports `@lore/core` only (`check:conventions`, `scripts/lore-package-graph.ts`), and reaches the other modules only through a core registry or a core link. Read the repository's `AGENTS.md` first, then `packages/@lore/core/AGENTS.md`: the barrels, the registries this package fills, and the conventions every package shares.

## Names

The pillar is **Build**: the package `@lore/build`, its modules `LoreBuildApi` and `LoreBuildMcp`, and the capability key `build`, off for every project by default. The thing it holds keeps the name **code**: the permissions `code:read`, `code:write` and `code:admin` (group `code`), the CLI `lore code ...`, the MCP tools `code_*` and the tables `code_*`. "Build" also names `lore apps build` and `alepha build`; they live in other namespaces.

## Permissions

- `code:read` (clone, fetch, list) is in every default rank, Viewer included.
- `code:write` (push) is in the Member default: a member may push.
- `code:admin` (create and delete a repository) is an Admin's. A `lore login` holds it (`LoreOAuthScopes.CLI_ONLY_PERMISSIONS`, #Q3965); an MCP token never does (`PARTIAL_GROUPS` gives it `code:read` and `code:write` only).

## Layout

`api/`, `mcp/`, `web/`, `schemas/` and `testing/`, as the other packages. `web/` holds Quality's pages (the Reports Quality tab, moved from Ship) and the code browser (#E167): `web/app/components/project/code/`, its shell `BuildShell` (Build's sidebar band, the commit link hook) and its routes in `BuildRouter`.

## Routes

| Path                                       | Route name         | Page (lazy)                                 | Notes                                                                                                                                                                                                    |
| ------------------------------------------ | ------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/:projectSlug/reports/quality`            | `reportsQuality`   | `project/reports/ReportsQuality.client.tsx` | Coverage and test totals pushed by CI (#Q3070), moved from Ship with its name and URL. The only Reports tab whose data is INGESTED, hence its empty state. Shown with `build`; reads `getReportsQuality` |
| `/:projectSlug/code`                       | `projectCode`      | `project/code/CodeRepositories.tsx`         | The repositories (#Q4133); one repository redirects to it. `listCodeRepositories` with `lastCommit: true`                                                                                                |
| `/:projectSlug/code/:repoSlug`             | `projectCodeRepo`  | `project/code/CodeRepoLayout.tsx`           | The plate and its tabs (`codeRepoTabs.ts`); fills `currentCodeRepoAtom` from `getCodeRepository`                                                                                                         |
| `/:projectSlug/code/:repoSlug/`            | `codeRepoHome`     | `project/code/CodeRepoHome.tsx`             | The default branch's root, or how to push the first commit                                                                                                                                               |
| `/:projectSlug/code/:repoSlug/tree/*`      | `codeRepoTree`     | `project/code/CodeTreePage.tsx`             | A folder; last commits from `getCodeTreeCommits` after the tree draws (#Q4134)                                                                                                                           |
| `/:projectSlug/code/:repoSlug/blob/*`      | `codeRepoBlob`     | `project/code/CodeBlobPage.tsx`             | A file; a folder reached by `blob` redirects to its tree                                                                                                                                                 |
| `/:projectSlug/code/:repoSlug/commits/*`   | `codeRepoCommits`  | `project/code/CodeCommitsPage.tsx`          | History, of a path when the tail names one (#Q4136)                                                                                                                                                      |
| `/:projectSlug/code/:repoSlug/commit/:sha` | `codeRepoCommit`   | `project/code/CodeCommitPage.tsx`           | A commit and its diff against `parents[0]`                                                                                                                                                               |
| `/:projectSlug/code/:repoSlug/branches`    | `codeRepoBranches` | `project/code/CodeBranchesPage.tsx`         | Ahead and behind the default branch, delete (#Q4137)                                                                                                                                                     |
| `/:projectSlug/code/:repoSlug/tags`        | `codeRepoTags`     | `project/code/CodeTagsPage.tsx`             | Tags, peeled                                                                                                                                                                                             |
| `/:projectSlug/code/:repoSlug/compare/*`   | `codeRepoCompare`  | `project/code/CodeComparePage.tsx`          | `<base>...<head>`, split on `...`                                                                                                                                                                        |
| `/:projectSlug/code/:repoSlug/blame/*`     | `codeRepoBlame`    | `project/code/CodeBlamePage.tsx`            | Blame, asked again every 2 s only while `pending` (#Q4138)                                                                                                                                               |

⚠️ **A trailing `*` holds `<revision>/<path>`**, since a branch name holds slashes: the server splits it at the LONGEST branch or tag that prefixes it, then a commit sha (`CodeBrowserService.locate`). Alepha's router matches `*` but does not compile it, so every code URL is built by `codeHref.ts`, never `router.path`. Every code route name is in core's `ROUTES_CODE` (`projectViewRoutes.ts`).

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
- **Receive-pack is read before the backend** (`GitReceivePack`): the ref commands, capabilities and push options ahead of the pack, buffered and replayed. Deleting the default branch, or pushing to a repository over `maxRepositorySizeMb` (disk only), is refused with a `report-status` git prints.
- **The default branch only moves forward** (#Q3953), refused by the backend, not the route. Node: an `update` hook Lore writes (`${DATA_DIR}/git/.hooks`, through `core.hooksPath`). Artifacts, which takes any force-push and has no setting against it: `ArtifactsGitBackend.guardedPush` sends the default branch's update to `refs/lore/incoming/<uuid>`, walks the ancestry with the binding's `log` and `readCommit` (parents included), then moves the branch by a command-only receive-pack with an empty pack, which Artifacts refuses as "stale ref" when the branch moved meanwhile, deletes the incoming ref, and rewrites the client's report to name the branch. Proven against a real namespace by `test/artifacts-contract.ts`; `test/artifacts-fast-forward.spec.ts` plays Artifacts with `git receive-pack`.
- **Backends serve** (`GitBackend.serve`): Artifacts proxies to `info.remote` with the cached repo token, streaming both bodies; Node spawns `git upload-pack|receive-pack --stateless-rpc`, writes the `# service=` line unless the client speaks v2, passes a validated `Git-Protocol` as `GIT_PROTOCOL`, and kills the child when the request aborts. A gzipped request body is inflated by the route first.
- **After a push** (`CodePushRecorder`, #Q3945): the route wraps a 200 receive-pack response in a pass-through stream that keeps a copy (1 MiB at most) and, at its end, reads the `report-status` (`GitReceivePack.acceptedRefs`, side-band demuxed). For each `refs/heads/*` update the backend reported `ok`, with an old and a new id, it lists the commits (`GitBackend.commits`: `git log old..new` on disk, the binding's first-parent `log` on Artifacts, nothing when over 1,000 or when the old id is not met) and hands them to core's `CommitReferenceRegistry`, which Plan fills: a commit naming `#Q<n>` lands on that quest, `by` the pusher, deduped by sha prefix. A branch's creation and an import (`lore-import`) record no commit. Every accepted push writes a `code:push` activity row (coalesced over 5 minutes). Best effort: a failure is logged, never turned into a red push.

## CLI and MCP (#Q3934)

- `code_repo_list|create|delete` (`CodeTools`) are `lore code repo list|create|delete`, on the same actions; create and delete answer 403 to every MCP token (no `code:admin`), and work from the CLI.
- The CLI is git's credential helper (`LoreGitCredentials`, `lore git-credential`): `lore login`, `lore clone` and `lore code remote --add` install it per host behind an empty `helper =` entry, so a keychain helper never stores a short-lived token. `apps/e2e/cli/code.e2e.spec.ts` proves it from a clean HOME with a storing helper configured.

## Import (#Q3935)

- `lore code import` (`LoreCodeImport` in `@alepha/lore`) slices on Artifacts (the repository answers `backend: "artifacts"`) and pushes in one go on a local backend. A slice is at most 40,000 new objects and 60 MiB, found by counting candidate ranges (`rev-list --count --objects`, `--disk-usage`), never by pushing; a refusal as too big halves the budget; a merge over the budget alone goes through `refs/lore-import/<n>` first. Measured on this repository's `main` against a local bare remote: 12 pushes, 16 s, HEAD matching.
- Every import push carries the push option `lore-import`. Lore advertises `push-options` on every receive-pack advertisement and strips the options before the backend sees the push (`GitReceivePack`), so the marker works on Artifacts whatever it advertises.

## The code browser (#E167, folio #F1540)

- **Reads on both backends** (`GitBackend`, #Q4131): `resolve`, `tree`, `readTree`, `blob`, `file`, `commit`, `mergeBase`, `isAncestor`, `deleteRef`, and peeled tags on `refs()`. A blob's size is checked before its bytes (`too_large`); binary is a NUL in the first 8,000 bytes. One contract, `test/git-backend-contract.ts`, runs in Vitest on `LocalGitBackend` and on `ArtifactsGitBackend` over a git-played binding (`test/fixtures/gitPlayedArtifacts.ts`), and by hand against a real namespace (`test/artifacts-contract.ts`).
- **The commit index** (#Q4132): `code_commits`, `code_commit_paths` (changed against the first parent; a merge keeps only what it changed against EVERY parent) and `code_commit_parents` (the edges a recursive CTE walks for reachability, the same SQL on D1 and Postgres). All keyed by `repositoryId`, `restrict`, deleted by `CodeRepositoryService` before the row. A push indexes 50 commits inline through every parent (`CodePushRecorder.indexPush`); `code.index` does the rest 40 a run, resuming from the **frontier** (a parent edge no commit row answers, derived, never stored); `code.index-sweep` (hourly) and opening a repository page start it.
- **One line diff** (#Q4135): `LineDiff` (Myers, edit distance capped at 1,500) and `CodeDiffService` (1,000 files, 50 a page, eager hunks for 20 files within 1 MiB, 256 KiB / 5,000 lines a side, generated files collapsed). Anchors `path:old|new:line`; `CodeDiff` takes `renderLineAfter` and `renderFileHeaderActions` for pull requests.
- **Compare** (#Q4137): `CodeCompareService`, knowing nothing of pull requests, so #E169 calls it as is.
- **Blame** (#Q4138): `CodeBlameService` walks versions back by their **producer**, the indexed commit that wrote the blob at the path, diffing parents' versions; 25 producers in the request, then `code.blame` to 200; kept in `code_blame_cache`.
- **The gate** (`CodeReadAccess`): every code read 404s with `build.repositories` off (the documented exception of `route-capability-guards.spec.ts`), and a job key reads only the repository it is pinned to.
- **Commits link into Lore only** (#Q4136): `projects.repositoryUrl` is gone; core's `CommitLinkRegistry` takes Build's `useCodeCommitHref`, and Plan answers which quests a commit landed on through `CommitReferenceRegistry.questsForCommits`.
- **Agents** (#Q4139): `code_tree`, `code_file`, `code_log`, `code_commit`, `code_diff`, `code_blame` (`CodeReadTools`), each `lore code tree|cat|log|show|diff|blame`, sized for a context window (200 lines a call, a diff's files before its hunks).
- `test/fixtures/codeRepo.ts` (`bootCodeRepo`, `GitHistory` with fixed dates) is what the specs build histories with.

## Quality (moved from Ship, #E162)

- **Two options since #Q4005**: `repositories` gates git hosting (the `code_*` actions and tools, git smart HTTP, the `code` activity kind) and `quality` gates Quality. A project that had Build before the split was migrated to both on (`20261121020224_build_options`).
- **A push is never gated**: `QualityController.pushQualityRun` answers whatever the switches say (`capability-gate.spec.ts`). What `build.quality` gates is the Reports tab (`BuildShell`), the tiles (`BuildDashboardMetrics`, `QualityNumericCatalog`), the event `coverage.dropped` (`BuildProjectEvents`) and the `quality` permission group.
- **Thresholds are core's** (`ProjectThresholds`, `project_thresholds`): Build checks coverage on a push on `main` (`CoverageThreshold`), Ship open errors hourly. The coverage target and alert stay on Ship's settings page.
- **Tags on the curve** come from Ship's artifacts through core's `BuiltTagRegistry`, which Ship fills (`DeployBuiltTags`).
- Build's own merge step moves `quality_runs` (`BuildProjectMerge`) and its summary line is coverage (`BuildReportsSummary`).

## Tests

`test/` holds the specs whose subject is Build, booting `LoreBuildApi` (and `LoreBuildMcp`) alone through `@lore/build/testing` (`BuildTestEntities`). A spec that needs another pillar is a scenario and lives in `apps/lore/test`.
