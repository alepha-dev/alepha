# AGENTS.md: @lore/build

**Build**, Lore's fourth pillar (#E162, design folio #F1500): the code a project holds. It sits between planning and shipping: git repositories now, CI and pull requests later. It imports `@lore/core` only (`check:conventions`, `scripts/lore-package-graph.ts`), and reaches the other modules only through a core registry or a core link. Read the repository's `AGENTS.md` first, then `packages/@lore/core/AGENTS.md`: the barrels, the registries this package fills, and the conventions every package shares.

## Names

The pillar is **Build**: the package `@lore/build`, its modules `LoreBuildApi` and `LoreBuildMcp`, and the capability key `build`, off for every project by default. The thing it holds keeps the name **code**: the permissions `code:read`, `code:write` and `code:admin` (group `code`), the CLI `lore code ...`, the MCP tools `code_*` and the tables `code_*`. "Build" also names `lore apps build` and `alepha build`; they live in other namespaces.

## Permissions

- `code:read` (clone, fetch, list) is in every default rank, Viewer included.
- `code:write` (push) is in the Member default: a member may push.
- `code:admin` (create and delete a repository) is an Admin's, and never a token's: `LoreOAuthScopes.PARTIAL_GROUPS` gives an MCP or CLI token `code:read` and `code:write` only, so a repository is deleted with a signed-in session or an API key.

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

## Quality (moved from Ship, #E162)

- **A push is never gated**: `QualityController.pushQualityRun` answers whatever the switches say (`capability-gate.spec.ts`). What `build` gates is the Reports tab (`BuildShell`), the tiles (`BuildDashboardMetrics`, `QualityNumericCatalog`), the event `coverage.dropped` (`BuildProjectEvents`) and the `quality` permission group.
- **Thresholds are core's** (`ProjectThresholds`, `project_thresholds`): Build checks coverage on a push on `main` (`CoverageThreshold`), Ship open errors hourly. The coverage target and alert stay on Ship's settings page.
- **Tags on the curve** come from Ship's artifacts through core's `BuiltTagRegistry`, which Ship fills (`DeployBuiltTags`).
- Build's own merge step moves `quality_runs` (`BuildProjectMerge`) and its summary line is coverage (`BuildReportsSummary`).

## Tests

`test/` holds the specs whose subject is Build, booting `LoreBuildApi` (and `LoreBuildMcp`) alone through `@lore/build/testing` (`BuildTestEntities`). A spec that needs another pillar is a scenario and lives in `apps/lore/test`.
