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

## Quality (moved from Ship, #E162)

- **A push is never gated**: `QualityController.pushQualityRun` answers whatever the switches say (`capability-gate.spec.ts`). What `build` gates is the Reports tab (`BuildShell`), the tiles (`BuildDashboardMetrics`, `QualityNumericCatalog`), the event `coverage.dropped` (`BuildProjectEvents`) and the `quality` permission group.
- **Thresholds are core's** (`ProjectThresholds`, `project_thresholds`): Build checks coverage on a push on `main` (`CoverageThreshold`), Ship open errors hourly. The coverage target and alert stay on Ship's settings page.
- **Tags on the curve** come from Ship's artifacts through core's `BuiltTagRegistry`, which Ship fills (`DeployBuiltTags`).
- Build's own merge step moves `quality_runs` (`BuildProjectMerge`) and its summary line is coverage (`BuildReportsSummary`).

## Tests

`test/` holds the specs whose subject is Build, booting `LoreBuildApi` (and `LoreBuildMcp`) alone through `@lore/build/testing` (`BuildTestEntities`). A spec that needs another pillar is a scenario and lives in `apps/lore/test`.
