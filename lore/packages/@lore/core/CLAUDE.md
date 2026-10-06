# CLAUDE.md: @lore/core

**The glue of Lore** (#E75, folio #F1356): projects, capabilities, ranks and permissions, notifications, audits, the resource registry and its link graph, search, Home, the dashboard, the Reports shell, agent prompts, and the web shell every module mounts into. It imports no other `@lore` package; `@lore/work`, `@lore/knowledge` and `@lore/deploy` depend on it (`check:conventions`, `scripts/lore-package-graph.ts`). Read the repository's `CLAUDE.md` first, then `apps/lore/CLAUDE.md` for the app itself.

## Layout

The source keeps the directory structure it had in `apps/lore/src` (`api/`, `mcp/`, `web/`, `testing/`), so the package's own files import each other relatively and a move never rewrote them. Everything else reaches the package by name, through five barrels:

| export               | holds                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@lore/core/api`     | `LoreCoreApi`, controllers, services, providers, security, the resource registry: server only                                                                        |
| `@lore/core/mcp`     | `LoreCoreMcp`, `ProjectTools`, the attachment commands, `ProjectContextRegistry`                                                                                     |
| `@lore/core/web`     | `LoreCoreWeb`, `CoreRouter`, `$pageProject`, components, atoms, registries, the dictionaries' `I18n` service                                                         |
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

`api/resources/ResourceRegistry.ts` is core's registry of linkable kinds. Each module registers its own (`QuestResourceKind`, `EpicResourceKind`, `ReleaseResourceKind`, `FeedbackResourceKind`, `FolioResourceKind`, `DirectoryResourceKind`, listed in each package's api module's `services` because nothing injects them): letter, `resolveNumbers`, `describe`, page, permission, search source, and `create`/`discard` where another module needs them.

- References: `ResourceLinkService` (the old `FolioLinkService`, still over `folio_links`) resolves `[[#Q12]]` through the kind owning the letter. A letter no module registers writes no row.
- Search: `SearchController` asks every registered search source; ranking stays in `searchRanking.ts`.
- Cross-module actions: a blight forward asks the `quest` kind to `create` (`require` refuses by name when absent); a quest delete calls `resources.deleted(...)`, and Deploy's `BlightQuestHandBack` subscribes with `onDeleted("quest")`.
- Never import another module's table or service to reach one of its rows: register a kind, or add what you need to the kind.

## Registries: core shows what a module owns (#E75, #Q2623)

Core reads no Work, Knowledge or Deploy table. Where core shows or polices something a module owns, the module registers it, and core asks:

| core registry                                                                                           | what modules register                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProjectCountRegistry`                                                                                  | per-project counts: Home's draft epics / open blights / pending feedback, the overview's areas / open quests                                                                                                                        |
| `AssignedWorkRegistry`                                                                                  | the viewer's open work, `getProjectById` / `BySlug`'s `quests` (kept narrow for published CLIs; the web reads `QuestController.getMyActiveQuests`)                                                                                  |
| `ProjectContextRegistry` (`mcp/services`)                                                               | `project_context` / `project_info` sections, merged in `order` so the output is unchanged                                                                                                                                           |
| `DashboardMetricCatalog` / `DashboardMetricRegistry` / `DashboardScopeService` / `DashboardCardService` | metric descriptors (browser-safe; each module's api module lists its own and its web module injects them), resolvers (they register themselves), the `apps` / `epic` / `release` scope kinds (as generic `subjects`), default cards |
| `FileAccessRegistry`                                                                                    | who may read each attachment bucket                                                                                                                                                                                                 |
| `ProjectDeletionService.registerStep`                                                                   | what a module deletes with a project                                                                                                                                                                                                |
| `ResourceRegistry`                                                                                      | linkable kinds, see below                                                                                                                                                                                                           |

Two more cuts are not registries: `$relations` is one value per module (`api/relations/*Relations.ts`), and the analytics datasets are `ProjectAnalytics` (core) and `DeployAnalytics`. `CapabilityRegistry` derives each capability's options schema from its own descriptor; `test/capability-options-schemas.spec.ts` holds it equal to the module's schema. A module's own `$hook` (`QuestMemberRemoval` on `organization:member:removed`) needs no registry at all.

### The web shell's registries (#E75, #Q2624)

The browser side follows the same rule: core's web code (`ProjectView`, the editor, the dashboard, the account area) names no module. Each module fills the registries in `src/web/app/registries/` from one shell service per module (`shell/WorkShell.ts`, `KnowledgeShell.ts`, `DeployShell.ts`) and one project loader (`loaders/`), all injected from the module's web module `register()` because nothing else would construct them.

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
(`apps/e2e/web/capabilities.spec.ts`). The wizard keeps an at-least-one rule, because a
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
  load. `apps/e2e/web/agent-prompts.spec.ts` catches exactly this, which is why its
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

## Routes

Defined in `src/web/app/CoreRouter.ts` (and the account pages in `LoreAccountRouter.ts`). A module's project pages join `CoreRouter`'s `project` layout through `$pageProject` (`parent:`). Route names (the `$page` keys) are what `router.path(...)` / `router.push(...)` consume.

| Path                                  | Route name                    | Page (lazy)                                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------- | ----------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                   | `home`                        | `home/Home.tsx`                            | The signed-in landing page, or the hero. A greeting, a search box whose dropdown searches every project the caller belongs to (`useHomeSearch` runs `SearchController.search` once per project, batched into one request: there is no cross-project action), and one column of recent projects (name, momentum, open counts; five shown, and "Show more" links to `/account/projects`). It replaced the projects `DataTable` and its ownership and activity filters. The Recent activity panel beside it was deleted in epic #E64: it read 15,989 audit rows per load to draw twenty lines. The momentum bars left `audits` in epic #E65 and read the `project_activity` `$analytics` dataset instead - zero D1 rows on production, where the hot tier is Analytics Engine. ⚠️ That read leaves the process, so `momentum` is **optional on the response**: absent means it could not be read, and the strip renders empty rather than as fourteen quiet days. An empty array would mute every row as inactive. `lastActivity` still reads `audits`, by one index seek per project |
| `/new-project`                        | `projectCreate`               | `project/ProjectCreate.tsx`                | New project form                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/:projectSlug`                       | `project`                     | `project/ProjectView.tsx`                  | Project layout — sets `currentProjectAtom` + releases/member/quests/feedback-count/blight-count/quest-count on load                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/:projectSlug/`                      | `projectActivity`             | `project/activity/ProjectActivityPage.tsx` | The project root since 2026-09-03. Every recorded write, newest first, read from `audits` scoped to this project. **Core**, so it survives every capability being off - what it SHOWS is narrowed to the enabled capabilities' audit `type`s, never purged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `/:projectSlug/reports`               | `projectReports`              | `project/reports/ReportsLayout.tsx`        | Reports layout                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `/:projectSlug/settings`              | `projectSettings`             | `project/settings/ProjectSettings.tsx`     | Settings layout (sub-routes below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `/:projectSlug/settings/`             | `projectSettingsBanner`       | `…/ProjectSettingsGeneralPage.tsx`         | General > Details: name, banner, data export, danger zone                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/:projectSlug/settings/capabilities` | `projectSettingsCapabilities` | `…/ProjectSettingsCapabilitiesPage.tsx`    | General > Capabilities (#Q2565): every capability's master switch, and nested under it the options a sidebar entry hangs off (`CAPABILITY_NAV_OPTIONS`: board, epics, releases, track). ⚠️ The only page that turns a capability back on, since an off capability's own settings section leaves the sidebar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/:projectSlug/settings/members`      | `projectSettingsMembers`      | `…/ProjectSettingsMembersPage.tsx`         | Members, their ranks and the pending invitations. A rank picker per row, and Transfer ownership in the row menu (owner only, and never a permission - a rank that could be granted the right to take ownership away would make ownership grantable). ⚠️ The list is `member:read`, which every rank holds; the pending invitations are `member:manage`, so the loader skips that read rather than 403ing the whole page                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/:projectSlug/settings/ranks`        | `projectSettingsRanks`        | `…/ProjectSettingsRanksPage.tsx`           | What each rank may do: permissions down the left, one column per rank, on `@alepha/ui`'s `PermissionMatrix`. The nav entry is gated on `rank:manage`; the ROUTE is not, like every other settings route. A group whose capability is off is dropped entirely rather than greyed, and a group the application never labelled (the framework's own `admin:*`, `api-key:*`, `file:*`) never appears                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/*`                                  | `notFound`                    | `NotFound`                                 | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/account/projects`                   | `accountProjects`             | `account/MyProjects.tsx`                   | Every project the signed-in user belongs to. `$pageAccount`, group `Lore`, and the one of the three with no `can()` gate — the endpoint is member-scoped, so the page is always reachable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/account/invitations`                | `accountInvitations`          | `account/MyInvitations.tsx`                | Pending invitations addressed to the signed-in user. Also `$pageAccount`, group `Lore`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Also top-level under the shared layout: `/auth/login` (`login`), `/oauth/continue` (`oauthContinue`), `/auth/register` (`register`), `/auth/reset-password` (`resetPassword`).

HTTP API routes follow the same vocabulary: `/projects/:id/quests/export`, `/quests/attachments`, `/kanban/:projectId`, `/projects/:projectId/feedback`. MCP tools are `project_*`, `quest_*`, `release_*`, `folio_*` (also `directory_*` / `folio_attachment_*`), `feedback_*`, `blight_*`, `sigil_*`, `insights_*`.

## ⚠️ `/:projectSlug` is a **root-level** param — three consequences

Since 2026-08-13 a project is addressed by a slug derived from its title, at the
root: `/sds/quests/19`, not `/p/2/q/19`. The `/p` prefix is **deleted, not
redirected**, and a rename **frees the old slug** for anyone else to take (the
settings page gates it behind a confirmation that says so). Slugs are unique
across the whole instance, so two projects can never share a title — anywhere,
including across different owners.

**Adding a root-level route means reserving its first segment.**
`ProjectSlugService.reserved` is what stops a project claiming a name the router
already owns. The router tries static children before the param child, so the
route wins and it is the _project_ that becomes unreachable — silently, and only
for whoever picked that name. `test/app-routes.spec.ts` resolves the real route
table and fails if any static root segment is missing from that list.

`account` joined that list when the profile pages moved onto `@alepha/ui`'s
`AccountRouter` — a worked example of the rule, since mounting a shared router
adds a root segment just as surely as writing one by hand.

**An anonymous typo lands on the login page, not a 404.** `/tpyo` matches
`:projectSlug`, which carries `$secure()`, so a logged-out visitor is redirected
to `/auth/login?redirect=/tpyo`. Unavoidable without a database round-trip ahead
of the guard. A signed-in visitor gets a real 404 from the `project` route's own
`errorHandler` — which exists solely for this and must not be removed.

**Router params are not typechecked.** `router.path()` takes
`params?: Record<string, any>`, and it merges the _current_ route's params
before yours — so a call site still passing `projectId` keeps working while you
are inside a project (the slug is inherited from state) and breaks only when
navigating in from Home or Spotlight. Renaming a param is therefore a grep job,
not a compile error. The same trap, from the other side, as the `$page`-rename
one below.

## ⚠️ A loader's `query` holds only what `schema.query` declares

`$page`'s loader context carries `query`, and it is **empty** unless the route
declares the param in `schema: { query: z.object({ … }) }`. Nothing says so:
an undeclared param simply reads `undefined`, the loader takes whichever
branch that implies, and the page renders as if the URL had carried nothing.

What makes it hard to see is that `useRouter().query` **inside the component**
is the raw URL query and is unaffected, so the same param is readable three
lines away, in a file the author is also editing. It cost an hour on the
invitation link (`?invitation=`), where the loader has to resolve the token
before the page can decide what it even is.

`login`'s `query.redirect_uri` read (the OAuth bridge) was the same shape and
the proof of the rule: it declared no schema, so it never fired once, and
every sign-in on the way to a consent screen landed on the home page. Fixed
with #Q2217, when the device approval page needed the same bridge.
`test/oauth-login-bridge.spec.ts` renders the page through the router rather
than calling the loader, because calling it directly skips the decode that
lost the value.

⚠️ **The other half of that bridge, `/oauth/continue`, reads its `to` from
`useRouter().query`, never `window.location`.** A push renders the new page
before it writes history, so an effect on arrival still sees the PREVIOUS
URL in the address bar. Any page that acts on its own query in a mount
effect has the same trap.

## ⚠️ Deleting or renaming a `$page` is not typecheck-protected

`router.path("someRouteName", ...)` / `router.push("someRouteName", ...)` are typed against the live route table — but only while the name exists. The moment a route is renamed or removed, any call site still passing the old name silently widens to the plain `string` overload instead of erroring. The build stays green; the call throws at render time, in production, the first time a user hits that code path. This bit the 2026-08 rename directly (`campaignQuest` → `projectQuest` etc., and the whole `Kanban` board route disappearing in favour of `?view=kanban`). **Deleting or renaming a route name requires grepping the whole `src/` tree for the old string**, including nav arrays like `ProjectSettings.tsx`'s sidebar list and `projectViewRoutes.ts`'s `ROUTES_APP` set, which reference route names as plain strings with nothing in the type system tying them to the routes they name (see the comment on `projectSettingsSigils` in `@lore/deploy`'s `ProjectSettingsAppsPage.tsx`). The app half of that set is guarded: `projectViewRoutes.spec.ts` walks the tabs declared under `projectApp` in `DeployRouter` and fails when one is missing from `ROUTES_APP`, `SECTION_HREF_ROUTES` or `SECTION_LABEL_KEYS`, which is how the Explore tab shipped half-registered (quest #1689).

`test/app-routes.spec.ts` is the automated half of that guard, added with the Apps page: it boots the real router and resolves every name the app hands the router **as a plain string** — each `router.path(…)` / `router.push(…)` call site and each `route: "…"` nav array in `src/` — asserting both that the name resolves and that no `:param` is left unsubstituted. A deleted route is a red test rather than a production throw. It is not a census of the route table (a `$page` nobody navigates to by name is not in it, and does not need to be), and it is only as complete as its list: the spec carries the two greps that regenerate it, and a name added to a nav must be added there too.

## State atoms

Live in `src/web/app/atoms/`. The `project` route loader (core's, plus each module's `ProjectLoaderRegistry` entry) fills the `current*` atoms on enter and clears them on leave, so components inside the layout can read them without re-fetching. Each module's atoms live in its own package and are listed in its `CLAUDE.md`.

⚠️ **This list and the route table below are generated.** Run `yarn w lore inventory` to print the real route table (booted from the router, not grepped), the real atom names and the real component count, then fold the result in by hand — the prose against each entry is the part no generator can produce. Both had rotted badly before that script existed.

**Per-project (set by `project` route loader)**

- `currentProjectAtom` — project metadata
- `currentProjectMemberAtom` — the viewer's membership row for this project

**Folios index (set by the `projectFolios` loader)**

- `currentFolioPathAtom` — breadcrumb chain for the active directory

**Global (per-user, not per-project)**

- `userProjectsAtom` — sidebar/home project list
- `spotlightOpenAtom` — whether the ⌘K palette is open. An atom because the two openers and the palette sit in different parts of the tree
- `projectNavAtom` — the destinations the palette can offer, published by the sidebar. Strings only: an icon is a React element and cannot live in a schema-validated atom, so `kind` carries enough for the palette to pick its own
- `realmSettingsAtom` — whether self-registration is open. Filled by the `home` loader for an ANONYMOUS visitor only, because the hero's single button is a signup CTA that dead-ends at "Registration is not available" once the switch is off, and the right button has to be in the first paint. Defaults open, so a realm config that could not be read costs a stranger one dead-end page and a legitimate visitor nothing. The gate itself is server-side; this is presentation

## Project access model

Lore projects are private. Every project-scoped endpoint is gated on
**membership AND a permission**, with **exactly one exception**: the roadmap
(below). The old `project.public` flag is not that exception and is not coming
back: it was removed, and its column was dropped with #E74.

### Ranks: what a member may do (epic #E39, 2026-09-07)

"Member or owner" is gone as a two-value system. A membership row carries a
**rank**, and a rank is a permission set inside one project:

- **`role` is application-scope, `rank` is project-scope.** The same person is
  `user` everywhere; whether they may publish a release differs per project.
  Never conflate the two in prose either - that conflation is what the name
  was chosen to prevent. (The word `rank` also named the F/C/B/A/S difficulty
  scale erased on 2026-08-20. Unrelated, and the older meaning is dead.)
- **Effective access is application permission AND rank AND capability**,
  narrowing only. A rank can never widen what a role grants, and a capability
  that is off removes its permissions from every rank at once.
- **`projects.createdBy` is not an authorization input.** It cannot be, once
  ownership can be transferred: `organization_members.rank === "owner"` is
  the one answer, and the creator column is history. The old `members` table
  was dropped with #E74.
- **Two acts are owner-only structurally** and are never grantable to a rank:
  `project:delete` and `capability:manage`. One permission is never removable:
  `project:read`. Both lists are `LoreRankBounds`, in a file the browser can
  import - `LorePermissions` imports `$permission`, whose barrel has no
  browser condition.
- **Ownership is transferred, not assigned.** `assignOrganizationRank`
  refuses `owner`; `MemberService.transfer` swaps the two rows in one
  statement, because D1 has no transactions and a pair of writes can leave an
  organization with zero owners or two.

The vocabulary is `LorePermissions` (38 declarations, names that can never
change - they are stored as data in every rank definition), the active rank
resource and services live in `alepha/api/organizations`, and the presets are
`ProjectRankPresets`. A new project starts with the two built-ins, **Owner
and Member, and nothing else** (#Q2511, the GitHub model). Admin, Contributor
and Viewer are created on purpose from Settings > Ranks > Create rank, which
offers them (`ProjectRankController.getRankPresets`, computed from the
capabilities the project actually has) beside a blank rank; each lands as an
ordinary custom rank.

⚠️ **This reverses #Q2001.** `createProject` used to seed the three presets,
and a nightly sweep (`ranks.seed-missing-presets`) filled any project holding
no definition rows, because an owner opened the members page and asked where
Admin was (feedback #P2122). The owner then asked for the opposite, so both
are gone, and so is the Built-in badge on Owner and Member in the rank matrix:
those two are told apart by having no Delete. Presets already seeded in a
project stay: they are that owner's ranks now. A spec that needs one creates
it with `test/fixtures/presetRanks.ts`, an e2e with `createRankFromPreset`.

⚠️ **Where a rank is read on the client.** `currentProjectAtom.permissions` is
the effective set, filled by `getProjectBySlug`, and `canInProject` answers
**false** for an absent set. Every writer of that atom must go through
`setCurrentProject`, which carries `permissions` and `rank` forward - a writer
that spreads a plain project resource hides every rank-gated control on the
page, the whole sidebar included, until the next navigation.

**One mechanism now, and six documented exceptions.**
`$ownsProject` (below) is middleware in a `use:` array; it cannot be
forgotten the way a missing line in a handler can, it runs before the
handler on every transport including MCP, and it hands the rows it read to
the handler. Every project-scoped **action** is on it as of 2026-09-07,
including `ProjectController`'s own seven, which used to build `$owns` by
hand and restate the rule.

`ProjectSecurityService.assertMember` / `assertOwner` are **gone**. What
survives at the documented call sites is the organizations module's imperative check
(`RankService.assert`), each carrying a `ranks: imperative` marker saying why
a `use:` entry cannot serve it. Grep for that marker before adding a seventh:

- `LoreFileAccessProvider.assertReadable` - a `$secure` guard on a file route, deciding which project to ask about per bucket.
- `FeedbackController`'s `ensureOwner` / `ensureMember` - called from handlers, on a project resolved from a feedback row.
- `ProjectTools`'s project resolver - MCP, and it turns the gate's 403 into a 404 on purpose.
- `ProjectController.getProjectBySlug` - `$owns` keys on a primary key, and a slug is not one.
- `EstateCommandController`'s deploy branch - membership on the artifact's project, conditional, while the action's own gate is the estate's owner.

`DashboardScopeService` names `assertMember` and calls neither: a card scoped
to several projects has no single project to gate on, so it proves each id
against the caller's own membership set instead.

`isMember` / `isMemberById` are not going anywhere: they answer questions
that are not gates (branching on membership, or asking about somebody other
than the caller - `assignQuest` checks the assignee).

The single exception is the feedback module: `submitFeedback` and
`uploadFeedbackAttachment` are gated on the **Support** capability
being on instead of membership, so any logged-in Lore user can submit
feedback to a project that opts in. The feedback module toggle is the
owner's opt-in/out lever.

**Which side of the split an endpoint belongs on is now a PERMISSION, not a
side.** The work / configuration line survives as the shape of the default
`member` rank (`LorePermissions.MEMBER_DEFAULT`): the work is what a plain
member holds - quests, folios with their directories and attachments, kanban
moves, epics - and the configuration is what they do not - areas, releases,
kanban columns, sigils, invitations, project settings and portability, and the
triage decisions on feedback and blights.

⚠️ The difference from before is that the line is now **editable per project**
and the endpoint states its own requirement. Adding an endpoint means naming
the permission it needs in `$ownsProject({ requires })`, and adding that
permission to `MEMBER_DEFAULT` or to `OWNER_TODAY` in `LorePermissions` -
`member-permission-defaults.spec.ts` refuses a permission that lands on
neither.

### `$ownsProject` - the gate, and why it lives outside a class

`src/api/security/$ownsProject.ts` composes `$owns` into Lore's one
authorization rule, so a call site states only what varies:

```typescript
$ownsProject({ param: "projectId", requires: "quest:read" });
$ownsProject({
  repository: () => this.epics,
  param: "id",
  requires: "epic:write",
});
$ownsProject({
  repository: () => this.releases,
  param: "id",
  requires: "release:manage",
});
$ownsProject({ param: "projectId", from: "query", requires: "quest:read" });
```

⚠️ **`owner: true` is gone.** It was a two-value rank system hard-coded across
the app. Every gate is the membership join; what varies is the permission, and
"only the owner" is expressed by naming one on the never-grantable list - so
the refusal says which act was refused rather than that the caller is not
somebody special.

The `via` join onto `members`, both denial messages and
the 30s cache window are constants of this application, not of these
endpoints. `ProjectSecurityService` supplies the repositories.

**The gate is the READ HALF of the handler's check-then-write.** The row it
loads is the row the handler then inspects and writes, and no transaction
closes the window between the two: Lore runs on D1 and holds no
`$transactional` (see "No transactions in Lore" below). So a handler that
writes the gate's row back does it with `save()`, and `db.version()` on
`quests` and `folios` turns a write that landed in between into a 409; one
that guards a state change puts the precondition in the write's WHERE. Never
re-read the row in the handler and write that: the version it carries is not
the one the decision was made on.

`hops` covers the one two-hop case in the app: a quest comment references a
quest, and only the quest references the project.

```typescript
$ownsProject({
  repository: () => this.comments,
  param: "id",
  hops: [{ column: "questId", repository: () => this.quests }],
});
```

It is a module-level `const`, which the repo-root convention "never write
code outside classes" otherwise forbids. **This is the documented exception**,
and the reason is mechanical rather than stylistic: an in-class
`this.gates.member(...)` would force `gates = $inject(...)` to be declared
above every action in the file, which is exactly the field-ordering trap
`$owns`'s repository thunk was invented to avoid. A module-level const has no
ordering constraint. Every framework primitive is shaped this way for the
same reason.

## Schemas: derive from the entity, never restate a field

**A field is declared once, on the entity, and every other schema reaches it with `pick` / `omit` / `extend`.** Alepha shares a schema across the entity, the controller and MCP; the only reason to write `z.enum([...])` a second time is that nobody noticed the first one.

This is not hypothetical tidiness. Every duplicate found in the 2026-08 pass had already drifted: `sigils.lastSeenHost` was capped at 253 chars on the column and unbounded on the resource; a blight's `sigilId` was `z.uuid()` on the API and `z.string()` over MCP; a quest's status enum existed in four places, one of which listed three values and another four.

```ts
// The whole entity minus what the caller may not read.
export const sigilResourceSchema = sigils.schema.omit({
  tokenHash: true,
  createdBy: true,
});

// A narrower view of that, for one surface.
const sigilSchema = sigilResourceSchema.pick({
  id: true,
  name: true,
  kinds: true,
});

// One field, where a tool needs just the field.
export const prioritySchema = quests.schema.shape.priority;
```

`db.default(...)` and `db.ref(...)` return the schema itself, so `entity.schema.shape.x` is the plain zod type and `.extend({ x: ... })` re-describes a field without redeclaring its type. A departure from the column is fine when it is one — say so in a comment, the way `objectiveSchema` says why `id` is required on the way out and optional on the way in.

**File layout under `src/mcp/schemas/`.** A schema shared across tools gets its own file, named after it (`prioritySchema.ts`, `entityRefSchema.ts`). A single tool's `xxxParamsSchema` + `xxxResultSchema` pair stays in its family file (`questSchemas.ts`, `feedbackSchemas.ts`, …): the pair IS one contract, and the tool's field descriptions — which are its documentation, read by every agent on connect — belong beside it. `index.ts` re-exports everything, so no call site cares.

## I18n

Two languages: English (`en`) and French (`fr`). All translations in `src/web/app/services/I18n.ts`. Always use `tr()` from `useI18n<I18n, "en">()` — never hardcode strings.

## De-gamification (2026-07)

Lore has **no gamification currency**: no XP, no gold, no levels, no achievements, no titles, no per-project alias/avatar. All of it was removed in two passes:

- First pass killed the wall: `FeaturePaywallService` / Shop / `requiredLevel` quest gating. Ex-walled features (Reports, Quest Reminder, …) became plain owner toggles, and since epic #36 they are capability options.
- Second pass removed the remaining cosmetic progression and collapsed `characters` into `members` (migration `20260730154120_heavy_nova`: `ALTER TABLE characters RENAME TO members` + column drops — no rebuild, D1-safe). `CharacterInfo`, `AchievementEngine`, `CharacterController`, the character sheet, roster, XP bar and level-up animation are gone.
- Third pass (2026-08-20) erased **quest difficulty and its F/C/B/A/S rank letters** — column, API, MCP, CSV export, UI. This section used to list the ranks under "what survives"; that is reversed. The audit behind it: `difficulty` was a **required** input nothing consumed — no report read it, nothing sorted or filtered by it, and Lore's own code invented the value (blight forwarding hardcoded `2`). The migration is the single statement `ALTER TABLE quests DROP COLUMN difficulty` (no index, no FK on that column, so SQLite takes it without a rebuild). CSV import still **accepts and ignores** a `difficulty` header, so pre-erasure exports round-trip.

- Fourth pass reverses part of the third (2026-08-23): **`quests.size`** brings back a 1-5 scale, deliberately not the one that was erased. It is a **t-shirt size** (1 XS, 2 S, 3 M, 4 L, 5 XL) that answers "how big is this" rather than "how hard is this", so it describes the work instead of grading whoever picks it up, and it needs no glossary the way F/C/B/A/S did. Distinct from `estimateMinutes`, which is a duration claim: `L` promises no number of hours, which is what lets an agent pick a bucket honestly instead of inventing a figure. Mandatory, with a column default of 3, so every pre-existing row was backfilled to M and the create form pre-selects it; the migration (`20260823120550_long_payback`) is the single statement `ALTER TABLE quests ADD size integer DEFAULT 3 NOT NULL`, which SQLite takes without a rebuild, so `quest_comments` and the `dependsOn` self-reference are never touched. The ordinal is what is stored, so ordering stays in SQL; the labels live in `web/app/components/project/quest/questSize.ts` and the MCP field description carries the mapping.
  - ⚠️ **It has no reader yet.** Nothing sorts, filters or reports on `size` today, which is the exact charge that killed `difficulty` and the reason mandatory raises the stakes rather than lowering them. Known and accepted at the owner's call, not an oversight to copy: the sort, the filter and a Reports breakdown are what make the field worth its mandatory question.

What survives, deliberately:

- The RPG **vocabulary** for the work inside a project (quests, folios, blights, sigils) — flavor, not mechanics. **This is the whole of it**: the identity principle settled on 2026-08-20 is that Lore's RPG surface is vocabulary only, because "quest" names the agent-facing unit of work better than "task" (which can mean a markdown checkbox, a Jira ticket, anything). Mechanics are not identity. The container itself is deliberately _not_ RPG-flavored — see "The Lore of Lore" above for why it's `project`, not `campaign`.
- Two glyphs: `Swords` on Complete and `Signature` on Accept / "took the quest".

Do not reintroduce progression mechanics without an explicit decision — the goal is a neutral tool usable with other people; the metaphor describes the work, never the person.

## Key dependencies

- **CodeMirror 6** (`@codemirror/{state,view,commands,language,autocomplete,search,lang-markdown}` + `@lezer/highlight`) — the Edit half of the shared markdown surface (`src/web/app/components/shared/markdown-editor/MarkdownEditor.tsx`), still lazy and client-only. Its inner half is `MarkdownEditorInner.client.tsx`, so the server bundle carries no CodeMirror at all (1.6 MB with the grammars): a `.client` module is a stub on the server, see the routing guide. It is a **View/Edit toggle**, not a WYSIWYG editor: View renders through `@alepha/ui`'s `MarkdownView`, Edit is raw markdown. Per-context image upload is unchanged (folios → folio blobs; quests → attachments, embedded ids merged server-side by `QuestService.mergeEmbeddedAttachments`), but an upload now inserts `![name](assets/x)` **as text** — no `<img>` is ever written, and there is no live resize. The feedback request form keeps a plain textarea (its own paste/drag attachment flow).
  - Default mode is **content-based**: a folio with content opens in View, an empty one in Edit; quest surfaces always start in Edit. See folio #33.
  - ⚠️ **`@mdxeditor/editor` and the whole Lexical tree were removed.** Anything you read describing a formatting toolbar, `renderToolbar`, an editor "realm", `useEditorRealmCommands`, `normalizeEditorMarkdown` or the `.lore-mdx` CSS predates this and is wrong. The reader-side `rehypeSafeImg` in `@alepha/ui` went with it, so **no raw HTML is rendered as markup anywhere** now.
  - ⚠️ **`yarn dedupe '@codemirror/*'` after touching these deps** — `yarn add` will happily resolve a second `@codemirror/view` alongside the nested copy other packages pin, and two copies means incompatible `KeyBinding` types and a typecheck failure in `keymap.of([...])`.

## No transactions in Lore (#E69)

**Lore holds no `$transactional`, and `check:conventions` refuses one under
`apps/lore/src`.** Lore runs on Cloudflare D1, which has no transactions:
`$transactional()` runs the handler in place there, and a throw rolls nothing
back. Twenty-nine actions carried one until epic #E69, each promising an
atomicity production never had, and the suite could not tell, because the
SQLite driver the specs run on does roll back. The audit is folio #F1348.

Every write that needs protecting uses one of five patterns instead:

1. **A lost update: `db.version()` and `save()`.** `quests` and `folios` carry
   a version. Every Repository update bumps it, and `save()` of the row the
   gate read answers 409 when another write landed in between.
2. **A check-then-act: the precondition in the write's WHERE.**
   `updateOne({ id, status: "ready" }, …)`, a `notLike`, an `EXISTS` or a
   recursive CTE. A miss throws `DbEntityNotFoundError`: catch it and answer
   what it means (another request won, or 409).
3. **Several writes: validate first, then a safe order.** Everything a caller
   can trigger is refused before the first write; what must not be lost is
   written before the row; storage deletes go last. Compensate by hand where
   no order is safe (`createProject`).
4. **A unique name: claim it first.** `FolioNameService.claim` reserves the
   name under a pre-generated id before the row exists, and retries the next
   suffix on a `DbConflictError`. A rename is one UPDATE of the reservation
   row (`FolioNameService.rename`).
5. **What follows the main write: best effort.** See below.

Specs see D1's behaviour with `DATABASE_TRANSACTIONS: false` in the
container's env: `$transactional` would run bare, and interleavings and
partial writes become visible. A race is made deterministic by a
`repository:read:after` hook that lands the second request after the first
one's gate read (`test/quest-version-races.spec.ts`).

⚠️ **A read-write request reads from the D1 primary.** Read replication is on
for lore-production, and the generated worker opens every request that is
not GET, HEAD or OPTIONS on `first-primary`, except `POST /api/_batch`. So a
cookie-less agent never saves a stale replica row back over its own write.

### Writes after the main write are best effort (#Q2555)

Once an action's main write has landed, what follows it (the audit row, a
link sync, a mention, a revision) must never fail the action: a 500 for a
change that happened invites a retry that repeats it.

- **Audits are best effort in one place**: `LoreAuditService.record` catches a failed insert, logs it at error level and answers success. Never wrap a `logSuccess` in your own try/catch. `AuditService.create` (the admin API) still throws.
- **Everything else after the main write goes through `BestEffort.run(label, step)`** (`api/services/BestEffort.ts`): it logs a throw at error level with the `Error` itself, and returns `undefined`.
- **An error-level log is a blight**: the sigil reports every `log.error` (#Q2557). So a swallowed failure still reaches the blights inbox, and an expected condition logs at `warn`.

## Inventory

What this package holds, with the notes that are not obvious from the code. Moved from `apps/lore/CLAUDE.md` with the code (#E75); `yarn w lore inventory` prints the route table and the atoms from the live code.

**Controllers (4)** - `AdminMcp` (`GET /admin/mcp/calls`, behind `admin:analytics:read`: the MCP tool-call timeline and the per-tool leaderboard split by outcome, drawn on `/admin/mcp`. Admin rather than a project page, because a tool call is not scoped to a project and the audience is whoever maintains the tool descriptions), `ProjectRank` (one action: the three presets computed from the project's enabled capabilities; everything else about ranks is `alepha/api/organizations`), `Invitation`, `Project`.

**Entities (6)** - `files`, `folioLinks`, `identities`, `projects`, `sessions`, `users`.

**Services (8)** - `McpCallRates` (a `$hook` on the framework's `mcp:tool:end`, writing one point per MCP tool call into the `mcp_calls` `$analytics` dataset - the chart of #E65's premise, since a tool READ leaves no row anywhere else in Lore. ⚠️ Nothing injects it, so it is listed in `LoreCoreMcp`'s services; a `$hook` reaches a subscriber only if it was constructed), `LoreAuditService` (the framework's `AuditService` with one addition: every project-scoped audit row also writes a point into the `project_activity` `$analytics` dataset, best effort, skipping the app layer rather than filing it under an empty project - #E65. Substituted in `LoreCoreApi`'s own `register()`, because a substitution has to be recorded before anything resolves what it replaces), `ResourceLinkService`, `ProjectActivityService`, `ProjectLimits`, `ProjectSecurityService`, `ProjectPermissions` (the effective set: application permission AND rank AND capability), `ProjectRankPresets`.

**MCP tools (1)** - `ProjectTools` (including `project_activity`, the one call for everything that moved since a timestamp).

Organization membership, rank definitions, and invitations are owned by `alepha/api/organizations`; Lore's own `members`, `rank_definitions` and `invitations` tables were dropped with #E74.
