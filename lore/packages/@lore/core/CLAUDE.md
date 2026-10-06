# CLAUDE.md: @lore/core

**The glue of Lore** (#E75, folio #F1356): projects, capabilities, ranks and permissions, notifications, audits, the resource registry and its link graph, search, Home, the dashboard, the Reports shell, agent prompts, and the web shell every module mounts into. It imports no other `@lore` package; `@lore/work`, `@lore/knowledge` and `@lore/deploy` depend on it (`check:conventions`, `scripts/lore-package-graph.ts`). Read the repository's `CLAUDE.md` first, then `apps/lore/CLAUDE.md` for the app itself.

## Layout

The source keeps the directory structure it had in `apps/lore/src` (`api/`, `mcp/`, `web/`, `testing/`), so the package's own files import each other relatively and a move never rewrote them. Everything else reaches the package by name, through five barrels:

| export               | holds                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@lore/core/api`     | `LoreCoreApi`, controllers, services, providers, security, the resource registry: server only                                                                        |
| `@lore/core/mcp`     | `LoreCoreMcp`, `ProjectTools`, the attachment commands, `ProjectContextRegistry`                                                                                     |
| `@lore/core/web`     | `LoreCoreWeb`, `CoreRouter`, `ProjectRouter`, `$pageProject`, components, atoms, registries, the dictionaries' `I18n` service                                        |
| `@lore/core/schemas` | browser-loadable values: `api/schemas/*`, `mcp/schemas/*`, the entities, and the isomorphic classes (`CapabilityRegistry`, `DashboardMetricCatalog`, ...)            |
| `@lore/core/testing` | `projectFixture`, `CoreTestEntities` and the project and member helpers, `ReadCounter`, `createPresetRanks`, and what specs render that the web barrel must not name |

⚠️ **Three rules keep the barrels cheap.** They are what kept the Worker's boot at or under its pre-split cost (#Q2611's measurements).

- **The package is `sideEffects: false`**, so a barrel tree-shakes: importing `Button`-like pieces from `./web` does not drag the rest in.
- **A lazily loaded module is never re-exported as a value.** A module both statically and dynamically imported is hoisted into the static graph: its route ships no chunk of its own (the build's preload check refuses it) and, on the server, its whole closure lands in every isolate's boot. Re-export its types alone, or a lazy wrapper (`LazyProjectActivityPage`), and give specs `./testing`.
- **`LoreCoreWeb` registers its services from `register()`, never through `services`.** A listed service is tagged with its module, and injecting it anywhere registers the whole module; since every component is imported from this barrel, a spec rendering one would boot the router and the UI module behind it.

Entities are in `./schemas`, not `./api`: a module's entity (an epic) references core's `projects`, and module schemas derived from entities reach the browser. `ProjectAnalytics` is the exception, in `./api`, because `$analytics` pulls the server half of `alepha/api/analytics`.

## Tests

`test/` holds the specs whose subject is core, and they boot `LoreCoreApi` (and `LoreCoreMcp`) alone, through `@lore/core/testing`'s helpers. A spec that needs a module registered (Home's per-module counts, an endpoint of a module) is a scenario and lives in `apps/lore/test`. `CoreTestEntities` is the repository bag a spec constructs before `start()`; a module's fixture extends it, and the helpers find whichever bag the container built.

## Resources: everything linkable (#E75, #Q2610)

`api/resources/ResourceRegistry.ts` is core's registry of linkable kinds. Each module registers its own (`QuestResourceKind`, `EpicResourceKind`, `ReleaseResourceKind`, `FeedbackResourceKind`, `FolioResourceKind`, `DirectoryResourceKind`, listed in `LoreApi`'s services because nothing injects them): letter, `resolveNumbers`, `describe`, page, permission, search source, and `create`/`discard` where another module needs them.

- References: `ResourceLinkService` (the old `FolioLinkService`, still over `folio_links`) resolves `[[#Q12]]` through the kind owning the letter. A letter no module registers writes no row.
- Search: `SearchController` asks every registered search source; ranking stays in `searchRanking.ts`.
- Cross-module actions: a blight forward asks the `quest` kind to `create` (`require` refuses by name when absent); a quest delete calls `resources.deleted(...)`, and Deploy's `BlightQuestHandBack` subscribes with `onDeleted("quest")`.
- Never import another module's table or service to reach one of its rows: register a kind, or add what you need to the kind.

## Registries: core shows what a module owns (#E75, #Q2623)

Core reads no Work, Knowledge or Deploy table. Where core shows or polices something a module owns, the module registers it, and core asks:

| core registry                                                                                           | what modules register                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProjectCountRegistry`                                                                                  | per-project counts: Home's draft epics / open blights / pending feedback, the overview's areas / open quests                                                                           |
| `AssignedWorkRegistry`                                                                                  | the viewer's open work, `getProjectById` / `BySlug`'s `quests` (kept narrow for published CLIs; the web reads `QuestController.getMyActiveQuests`)                                     |
| `ProjectContextRegistry` (`mcp/services`)                                                               | `project_context` / `project_info` sections, merged in `order` so the output is unchanged                                                                                              |
| `DashboardMetricCatalog` / `DashboardMetricRegistry` / `DashboardScopeService` / `DashboardCardService` | metric descriptors (browser-safe, in `LoreDashboardCatalog`), resolvers (they register themselves), the `apps` / `epic` / `release` scope kinds (as generic `subjects`), default cards |
| `FileAccessRegistry`                                                                                    | who may read each attachment bucket                                                                                                                                                    |
| `ProjectDeletionService.registerStep`                                                                   | what a module deletes with a project                                                                                                                                                   |
| `ResourceRegistry`                                                                                      | linkable kinds, see below                                                                                                                                                              |

Two more cuts are not registries: `$relations` is one value per module (`api/relations/*Relations.ts`), and the analytics datasets are `ProjectAnalytics` (core) and `DeployAnalytics`. `CapabilityRegistry` derives each capability's options schema from its own descriptor; `test/capability-options-schemas.spec.ts` holds it equal to the module's schema. A module's own `$hook` (`QuestMemberRemoval` on `organization:member:removed`) needs no registry at all.

### The web shell's registries (#E75, #Q2624)

The browser side follows the same rule: core's web code (`ProjectView`, the editor, the dashboard, the account area) names no module. Each module fills the registries in `src/web/app/registries/` from one shell service per module (`shell/WorkShell.ts`, `KnowledgeShell.ts`, `DeployShell.ts`) and one project loader (`loaders/`), all listed in `web/app/index.ts`'s `services` because nothing injects them.

| core web registry          | what modules register                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `ProjectLoaderRegistry`    | what the `project` page loader fetches, in one `Promise.all`, and clears on leave                                       |
| `ProjectShellRegistry`     | sidebar entries and badges, settings sections and panels, the "+" menu, breadcrumb leaves, the aside pane, palette rows |
| `ElementReferenceRegistry` | `[[#Q12]]` kinds: rows, picker suggestions, href, hover preview, image upload                                           |
| `ResourceTabRegistry`      | tabs on another module's page: Artifacts on a release, Folios on an epic                                                |
| `DocumentSinkRegistry`     | where a generated document is saved (folios)                                                                            |
| `AgentPromptRegistry`      | prompt kinds: default template, icon, label                                                                             |
| `DashboardPickerRegistry`  | the dashboard's app, tag, epic and release pickers                                                                      |
| `AccountDeletionRegistry`  | the lines the account deletion dialog warns with                                                                        |

⚠️ An entry that carries a HOOK (`useReferences`, `useCollection`, `useOptions`, `useLine`...) is called once per entry, in a loop. That is legal only because these registries freeze the first time they are read: register from a shell's constructor, at boot, never later. A badge, a predicate or a breadcrumb reads module state through `ProjectShellContext.get`, never a hook, and declares the atoms it reads in `reads`. A module's account page is its own `$pageAccount` class (`WorkAccountRouter`, `DeployAccountRouter`), and filing across modules goes through core's `ResourceFilingController`. Browser-loadable runtime values (`CapabilityRegistry`, `DashboardMetricCatalog`, `KanbanColumnConfig`, `ProjectSlugService`, constants) live in `api/schemas/`, never in `api/entities` or `api/services`.

## Capabilities: what a project DOES

Since epic #36 (2026-09-06) a project is not a quest tracker with extras. It is
a container that composes four **capabilities**, picked in the creation wizard
and switched in Settings ▸ General ▸ Capabilities:

| capability  | what it brings                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `work`      | quests, areas, epics, releases, the board - options `board` / `epics` / `releases` / `estimate` / `chrono` / `reminder` / `agentPrompts` |
| `knowledge` | folios, their directories and attachments - option `agentSummary`                                                                        |
| `apps`      | deployed copies, sigils, blights, artifacts, quality - options `track` / `deploy`                                                        |
| `support`   | the feedback inbox and the first-party request form. No options                                                                          |

A **capability** is a product surface: it owns nav entries, routes, entities,
MCP tools, a settings page, dashboard cards, search kinds, activity kinds and
permissions. An **option** is a switch inside one. The old `projects.features`
column conflated the two, which is what this epic fixed; it was dropped with #E74.

Everything not claimed above is **Core** and always on: project identity,
members, settings, and the three surfaces that _compose_ capabilities - the
dashboard, the activity feed and the command palette. Reports is Core too, and
each of its tabs declares its own capability, because Quality is Apps baseline
and Members comes from a core table.

**Where it lives.**

- Declarations: `src/api/schemas/CapabilityRegistry.ts` - one class, browser-safe, holding every capability's options, MCP tools, search kinds, activity kinds, dashboard cards and permission groups. The web reads it through the module-level instance in `src/web/app/services/capabilityRegistry.ts`.
- Storage: the `project_capabilities` table, `(projectId, key)` unique, with the options as JSON. **A row exists if and only if the capability is on**; there is no `enabled: false`.
- Server read: `ProjectSecurityService.capabilitiesOf` / `capabilityRowsOf`, memoised per request and cached 30s like the project row. `capabilityRowsForProjects` is the batched form.
- Server gate: `assertCapability`, reached three ways - the `capability` option on `$ownsProject`, a call by hand beside `assertMember` in the controllers that still gate in-handler, and MCP through the controller action's own `use:` chain.
- Web read: `hasCapability` / `capabilityOption` in `src/web/app/services/projectCapabilities.ts`, off `currentProjectAtom`. Module-level functions because `$page` loaders read them and a loader cannot inject.
- The sidebar as data: `src/web/app/components/project/capabilityNav.ts`.

**Three rules that are decisions, not accidents.**

- **Disabling HIDES, it never deletes.** Every quest, folio and feedback item survives its capability being turned off, and comes back untouched when it returns. Reads of existing data stay allowed; only writes refuse.
- **A CAPABILITY guards its routes; an OPTION does not.** `/quests`, `/folios`, `/apps` and `/feedback` 404 without theirs. `/kanban`, `/epics` and `/releases` have no guard at all - a saved link keeps resolving and the sidebar is what stops offering them. `test/route-capability-guards.spec.ts` pins both halves.
- **Routes answer 404, the API answers 400.** A page under a disabled capability does not exist; a write into one is a request the project understands and declines, and the refusal names the capability and where to turn it on.

**Settings has no floor.** Every capability may be turned off, the last one
included: a project with none is a legal state and the modularity test
(`e2e/capabilities.spec.ts`). The wizard keeps an at-least-one rule, because a
wizard is asking a question and "none" is not an answer to it.

## Agent prompts (epic #41)

Every surface that names a piece of work offers the prompt that hands it to a
coding agent. The owner writes those prompts once, in Settings.

**The switch is the Work option `agentPrompts`, and it is OFF by default with
no backfill.** So a project shows no Agent Prompts menu until someone opens
Settings ▸ Quests ▸ Features and turns it on, `lore.alepha.dev` included.

| piece          | where                                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the kinds      | `src/api/schemas/agentPromptKindSchema.ts` - item-scoped `epicReview`, `epicActivate`, `questWork`, `feedbackWork`; surface-scoped `feedbackLoop`, `blightTriage`, `questLoop` (the Quests page toolbar)      |
| the table      | `project_prompts (projectId, kind, template)`, unique on the pair. **A row exists only for a CUSTOMISED kind; absence means the built-in default**, and Reset deletes the row rather than storing the default |
| the write path | `ProjectPromptController` - member read, owner upsert, owner reset                                                                                                                                            |
| the defaults   | `src/web/app/prompts/` - one file per kind, registered by its module on `AgentPromptRegistry`                                                                                                                 |
| the renderer   | `src/web/app/prompts/renderPromptTemplate.ts` - seven placeholders, one pass                                                                                                                                  |
| the atom       | `projectPromptsAtom`, filled by the `project` route loader, cleared in `onLeave`                                                                                                                              |
| the hook       | `components/project/prompts/useAgentPrompt.ts`, plus `useAgentPromptSubject` (Work's typed helpers: `useWorkPromptSubject`) and `questAgentGate` beside it                                                    |
| the menus      | a `RowActionGroup` on the three tables, `AgentPromptsMenu` on the three detail pages                                                                                                                          |

**Four rules, and none of them is obvious from the code.**

- ⚠️ **The copy happens INSIDE the click, with nothing awaited before it.**
  Safari's transient activation does not survive an `await` before
  `navigator.clipboard.writeText`. That is why the templates are read once per
  project into an atom instead of fetched at click time, and it is why the
  epic-review DIALOG existed before this epic. `useAgentPrompt.copy` must
  never grow a fetch.
- ⚠️ **The prompts are read by the `project` route loader, not by a
  component**, gated on `capabilityOption(project, "work", "agentPrompts")`,
  beside `currentEpicsAtom` and `currentAreasAtom`. It catches to `{}` and not
  to `undefined`, unlike its neighbours: they distinguish "could not read"
  from "none" because a badge must not say zero when it means unknown, and
  here the built-in defaults are a complete answer either way.
- ⚠️ **The Settings section refetches the rows unconditionally**, and that is
  load-bearing rather than tidy. The loader writes `{}` when the option is off
  AND when nothing is customised, so the atom cannot say whether it was ever
  filled, and flipping the switch does not re-run the loader. Without the
  refetch, an owner with stored templates who turns the option on and copies
  from Epics gets the built-in defaults, silently, until the next full page
  load. `e2e/agent-prompts.spec.ts` catches exactly this, which is why its
  navigation from Settings to Epics is a sidebar CLICK and never a
  `page.goto`.
- ⚠️ **`{{project}}` is the project's TITLE and `{{slug}}` is its slug.**
  `ProjectTools.resolveProjectId` matches `project_name` against
  `projects.title` lowercased FIRST, and only then against the slug it
  derives from each title. Both spellings resolve since #Q1968; before it,
  a project titled `Kanban v2` was not findable by `kanban-v2` at all, and
  the prompt that shipped with this epic resolved only because this project
  is titled `Alepha`. The slug pass **derives** rather than reading
  `projects.slug` (a stored slug is disambiguated on collision), and refuses
  when two titles slugify alike rather than picking one.

Two smaller things worth not rediscovering. A subject is **seven named
fields**, built by `useAgentPromptSubject` and never a resource: this text
goes to a clipboard, and a feedback resource carries the reporter's identity,
their `context` and their attachments. And `AgentPromptsMenu`'s `subject` is a
**thunk**, called on click, because building one reaches for the router and an
eager one runs on every render of every surface that might show the menu.
