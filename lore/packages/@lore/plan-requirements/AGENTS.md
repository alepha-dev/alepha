# AGENTS.md: @lore/plan-requirements

**Plan's Requirements** (#E153, folio #F1515): personas (`#A`), use cases (`#U`) and requirements (`#S`), verified by runs and traced to epics and releases. Read the repository's `AGENTS.md`, then `packages/@lore/core/AGENTS.md` and `packages/@lore/plan/AGENTS.md` first.

## It is Plan, not a capability

- There is no `define` capability and nothing in the product is called Define. Requirements is an **option of Plan**, `requirements` (`planCapabilityOptionsSchema`, the `plan` descriptor in `CapabilityRegistry`), offered in the creation wizard and off by default, like Epics. Every tool, search kind, activity kind, dashboard card and permission group this package brings is added to **Plan's** lists in `CapabilityRegistry`, hanging off the option through `mcpToolOptions`, `searchKindOptions`, `activityKindOptions` and the cards' `needs`.
- **The sidebar gains one entry and nothing else moves** (owner, answers 53 and 64): Requirements, in the `work` band at `order: 35`, after Epics. `RequirementsShell` adds it with core's `ProjectShellRegistry.extendNav("plan", ...)`, since `WorkShell` owns Plan's `registerNav`. No band is added, titled or reordered.
- **The page** is a plate-less `PlateLayout` (answer 73) with three route tabs, in this order (answer 70): Requirements (`/requirements`), Use cases (`/requirements/use-cases`), Personas (`/requirements/personas`). Each tab owns its toolbar; nothing sits above the tabs. A persona or use case page is a full page outside the layout, without the tab bar (decision 77), under its tab's URL.

## The package graph: one way only

`"plan-requirements": ["core", "plan", "remember", "ship"]` (`scripts/lore-package-graph.ts`). It is the first package with sibling edges, because it writes Ship's errors, reads Ship's telemetry and reads Remember's folio revisions, which `@lore/plan` may not. **Plan, Remember and Ship never import it**: what they must ask of it goes through a registry they own and it fills (Plan's `ReleasePublishGuards`), or a hook it subscribes to (Remember's `folio:revision:created`). `lore-package-graph.spec.ts` pins both directions.

## The link graph mirrors, it does not store

`folio_links` holds `(fromType, fromId, targetType, toId, relation)` and nothing else, and is not migrated for this package. Three relations beside `filed` are **mirrors** of this package's own tables, so backlinks and `[[#A2]]` work:

| relation | edge                 | the truth, with the attributes the row cannot hold |
| -------- | -------------------- | -------------------------------------------------- |
| `actor`  | persona to use case  | `use_case_actors` (the actor's role)               |
| `covers` | epic to use case     | the row itself: an edge with no attribute          |
| `source` | requirement to folio | the requirement's source anchor and revision       |

`verifies` is not a relation: a criterion is not a link kind, and `criteria.requirementId` holds that edge. Core's `ResourceLinkService.mirrorInbound` / `mirrorOutbound` rewrite a mirror, and `deleteMirrorsTo` drops the rows onto deleted targets.

## No transaction (D1)

Lore runs on D1, and `check:conventions` refuses `$transactional` in `packages/@lore` (read "No transactions in Lore" in core's `AGENTS.md`). The order is fixed: **the package's own table is written first**, then its mirror row through `BestEffort.run`, and every save of the source rewrites its mirror, so a lost row heals on the next save. A reader trusts the table, never the mirror.

## Layout and tests

Same barrels as its siblings: `./api` (`LorePlanRequirementsApi`), `./mcp` (`LorePlanRequirementsMcp`), `./web` (`LorePlanRequirementsWeb`), `./schemas` and `./testing`, registered by `apps/lore`'s entries after core, plan, remember and ship, and booted by `bootLore()`. Its vitest projects are spread by the root `vitest.config.ts`. `test/` holds the specs whose subject is this package; a spec that needs the whole app is a scenario in `apps/lore/test`.
