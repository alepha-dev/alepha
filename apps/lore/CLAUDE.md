# Alepha Lore

Project management app built with [Alepha](https://github.com/feunard/alepha). Users create **projects**, forge **quests** with objectives, invite **members**, and progress together across **areas**. The RPG vocabulary describes the work, never the person — there is no XP, gold, level or achievement system (see "De-gamification" below).

It has since grown well past a quest tracker. The load-bearing surfaces today are **quests** (roadmap + in-flight work), **folios** (project memory, wiki-linked, optionally end-to-end encrypted, and — since the 2026-08 rename — including the directory tree + binary blobs that used to be a separate "Archive" module), **feedback** (inbound bug/feature triage), and **blights** (deduplicated crash telemetry from partner sites via **sigils**). All four are exposed over **MCP**, which is the primary consumer.

Alepha Lore is the **only public Alepha app** and exists in large part to **dogfood the framework** — improvements and bug fixes upstream are part of the job, not a side quest.

## The Lore of Lore (start here)

The production Alepha Lore instance hosts the project we actually use to run this project: **`https://lore.alepha.dev/lore`** — the "Lore of Lore", **project id `2`** over MCP. The web URL is slug-addressed since 2026-08-13 (`/p/2` no longer resolves); the slug comes from the project's title, "Lore", via the backfill in `20260813135343_nappy_excalibur`. MCP still addresses it by id, so the id stays the durable reference. It is the canonical source of truth for what's planned, in-flight, and remembered on Alepha Lore itself. It also dogfoods the MCP surface — every Claude session working on this repo should treat that project as a first-class input, not background trivia.

**Before non-trivial work, orient via MCP** (these tools are already exposed on `mcp__claude_ai_Lore__*` for this account, project id `2`):

1. `project_context` — one-shot orientation (project metadata + active quests + folio index, ~2K tokens).
2. `folio_get` on the folios that look relevant — folios are the shared memory between you and the user across sessions. The user relies on them heavily, so **read first, write often**.
3. `quest_list` / `quest_get` — quests are the **most load-bearing** piece. They are the roadmap and the in-flight work tracker. If a task corresponds to a quest, drive it from the quest (read objectives, update status, complete on done).

**Write back what's worth keeping.** When a session produces a non-obvious decision, gotcha, or architectural fact about Lore/Alepha, persist it as a folio (`folio_create` / `folio_update` with a good `summary`). When in-flight work changes scope or completes, reflect it on the matching quest. Conversation history is ephemeral; folios and quests are the project's long-term memory.

Lore's vocabulary has been renamed twice. Originally the codebase used the plain technical names `project`/`task`/`package`/`players`/`analytics`/`complexity`; a first rename swapped every one of those for RPG flavor — `campaign`/`quest`/`zone`/`member`/`chronicles`/`difficulty` — across code identifiers, DB tables, HTTP routes, MCP tools and URL params. The **2026-08 great rename** partially reversed that: the top-level container went back to the plain, technical **`project`** (campaign → project, `/c/:campaignId` → `/:projectSlug`, `campaign_*` MCP tools → `project_*`), because "campaign" read as more RPG-themed than the container itself deserved. The RPG vocabulary that describes the _work inside_ a project was kept and in some cases sharpened: **quest**, member, folio, blight, sigil are all still RPG-flavored on purpose (the F/C/B/A/S difficulty ranks were part of that list until 2026-08-20, when the whole difficulty mechanic was erased — see "De-gamification" below). A later de-RPG pass (2026-08-09) then took **zone → `area`**: it named the functional part of the system a quest belongs to — "analogous to an Epic in Jira" by its own MCP description — and the map metaphor was carrying no weight. Column, route, `$page` name, MCP param and both locales moved together (FR: _Domaine_); the CSV importer still accepts a `zone` header so pre-rename exports keep working. Three other nouns were renamed in the same pass for clarity rather than theme: Petitions → **Feedback**, Chapters → **Milestones**, and Chronicles → **Reports** (with Reports▸Party → Reports▸Members). The old standalone "Archive" module (directory tree + blobs) was folded entirely into **Folios** — same entities, same MCP tools, one mental model instead of two. A **user** is the account; a **member** is that user's membership row in a project. Identity (name, picture) always comes from the account — the per-project "character" concept was removed in the 2026-07 de-gamification pass.

All user-facing strings still go through `I18n.ts` for EN/FR localization.

## Repository layout

Lore lives inside the **Alepha monorepo** at `apps/lore`. The Alepha framework is a sibling workspace at `../../packages/alepha`; the shared shadcn UI lives at `../../packages/@alepha/ui`. Yarn workspace links route imports of `alepha` / `@alepha/ui` to those local packages — no vendoring, no sync step.

**Why this matters for AI:** Alepha is a small framework that LLMs have **near-zero training data on**. Do not guess Alepha APIs from memory — they will be wrong. Read `../../packages/alepha/src/...` and `../../packages/@alepha/ui/src/...` as the authoritative source whenever framework behavior matters. Editing them from inside `apps/lore` is fine — they're the same monorepo. Run `yarn v --fast` from the monorepo root to verify framework + lore together.

```
apps/lore/                # This app
├── src/                  # App source
│   ├── api/              # Backend
│   │   ├── controllers/  # 20 controllers — see list below
│   │   ├── entities/     # 23 entities — see list below
│   │   ├── providers/    # AppSecurityProvider (membership/owner gates), LoreFileAccessProvider (per-file IDOR gate), LoreSigilSinkProvider (in-process self-report — a Worker can't fetch its own hostname)
│   │   ├── jobs/         # BlightJobs (retention purge), SigilJobs (analytics collapse), InvitationJobs, MilestoneJobs, QuestJobs (reminder sweep)
│   │   ├── schemas/      # Request/response schemas
│   │   └── services/     # 18 services — see list below
│   ├── mcp/              # MCP protocol integration (tools, resources)
│   ├── web/
│   │   ├── app/          # Main SPA
│   │   │   ├── atoms/    # 19 state atoms — see "State Atoms" section
│   │   │   ├── components/  # ~121 React components
│   │   │   ├── services/ # I18n (EN + FR), Toaster
│   │   │   └── AppRouter.ts  # All routes
│   │   └── admin/        # Admin UI module
│   ├── main.server.ts    # Server entry (API + MCP + Web + Admin)
│   └── main.browser.ts   # Browser entry (Web + Admin)
├── test/                 # Unit / integration specs (vitest)
├── e2e/                  # Playwright specs (one file per feature)
├── migrations/sqlite/    # Drizzle migrations (D1 / SQLite)
└── public/               # Static assets served at /
```

**Controllers (19)** — `AdminInvitation`, `Blight`, `Blob`, `Directory`, `Feedback`, `FeedbackComment`, `Folio`, `Insights`, `Invitation`, `Kanban`, `Milestone`, `Project`, `ProjectQuestPortability`, `ProjectReports`, `Quest`, `QuestComment`, `Sigil`, `SigilIngest`, `Version`.

> `User`, `Session` and `Identity` were **deleted** when Lore moved onto the shared
> `/account` area: they duplicated the framework's `MyProfileController`,
> `MySessionController` / `MyConnectionController` and `MyIdentityController`
> respectively. `SessionController` in particular re-implemented all three of
> `MySessionController`'s actions verbatim. Reach for the `alepha/api/users` and
> `alepha/api/oauth` controllers instead of re-adding an app-local one.

**Entities (25)** — `blightIgnoreRules`, `blights`, `feedback`, `feedbackComments`, `files`, `folioBlobs`, `folioDirectories`, `folioLinks`, `folioNames`, `folioRevisions`, `folios`, `identities`, `invitations`, `members`, `milestones`, `projects`, `questComments`, `quests`, `sessions`, `sigilErrorGroups`, `sigilUniquesDaily`, `sigilViewsHourly`, `sigilVitalsHourly`, `sigils`, `users`.

**Services (19)** — `BlightRuleService`, `FeedbackRateLimiter`, `FolioBlobService`, `FolioDirectoryService`, `FolioHistoryService`, `FolioLinkService`, `FolioNameService`, `InvitationService`, `PinnedFolioFolder`, `ProjectActivityService`, `ProjectLimits`, `ProjectSecurityService`, `QuestCsvFormatter`, `QuestCsvParser`, `QuestImportFormatProvider`, `QuestResourceMapper`, `QuestService`, `SigilIngestService`, `SigilTokenService`, plus `parsers/`.

**MCP tools (8)** — `BlightTools`, `FeedbackTools` (`feedback_comment_add`, plus the thread inlined on `feedback_get`), `FolioTools` (absorbed the old `ArchiveTools`: `directory_*` / `blob_*` live here now), `InsightsTools`, `MilestoneTools`, `ProjectTools` (including `project_activity`, the one call for everything that moved since a timestamp), `QuestTools` (`quest_comment_add`, `quest_objective_set`, `quest_unassign`, `quest_attachment_get` / `_add`, `quest_commit_add`, and the discussion inlined on `quest_get`), `SigilTools`.

## Routes

Defined in `src/web/app/AppRouter.ts`. Route names (the `$page` keys) are what `router.path(...)` / `router.push(...)` consume.

| Path                                      | Route name                  | Page (lazy)                                   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------- | --------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                       | `home`                      | `home/Home.tsx`                               | Project list                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `/new-project`                            | `projectCreate`             | `project/ProjectCreate.tsx`                   | New project form                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/:projectSlug`                           | `project`                   | `project/ProjectView.tsx`                     | Project layout — sets `currentProjectAtom` + milestones/member/quests/feedback-count/blight-count/quest-count on load                                                                                                                                                                                                                                                                                                                                     |
| `/:projectSlug/`                          | `projectQuests`             | `project/ProjectQuestsPage.tsx`               | Quest list grouped by area; renders the kanban board instead when `questsViewAtom` says `kanban` (see "Kanban ↔ Header Communication" below — kanban is no longer its own route, and no longer a `?view=` param either)                                                                                                                                                                                                                                   |
| `/:projectSlug/milestones`                | `projectMilestones`         | `project/milestones/ProjectMilestones.tsx`    | Milestones list                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/:projectSlug/reports`                   | `projectReports`            | `project/reports/ReportsLayout.tsx`           | Reports layout                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/:projectSlug/reports/`                  | `reportsOverview`           | `project/reports/ReportsOverview.tsx`         | Overview                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/:projectSlug/reports/quests`            | `reportsQuests`             | `project/reports/ReportsQuests.tsx`           | Quest analytics                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/:projectSlug/reports/members`           | `reportsMembers`            | `project/reports/ReportsMembers.tsx`          | Per-member contribution (was Reports▸Party)                                                                                                                                                                                                                                                                                                                                                                                                               |
| `/:projectSlug/feedback`                  | `projectFeedback`           | `project/feedback/ProjectFeedback.tsx`        | Owner inbox: triage bug/feature requests                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/:projectSlug/blights`                   | `projectBlights`            | `project/blights/ProjectBlights.tsx`          | Crash-telemetry inbox (sigil-fed)                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `/:projectSlug/apps/:appName`             | `projectApp`                | `project/apps/AppLayout.tsx`                  | One enrolled app: tab bar + the range toggle every tab shares. Param is `:appName` — the app's **name**, not its id; the HTTP API still addresses a sigil by UUID (rotate, delete, `?sigilId=`). **Never** `:id` — see the router note below                                                                                                                                                                                                              |
| `/:projectSlug/apps/:appName/`            | `app`                       | `project/apps/AppDashboard.tsx`               | Headline numbers + the credential card                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/:projectSlug/apps/:appName/analytics`   | `appAnalytics`              | `project/apps/AppAnalytics.tsx`               | Page views, unique visitors, top pages/countries. 404 when this app's own `kinds` lacks `beacon`                                                                                                                                                                                                                                                                                                                                                          |
| `/:projectSlug/apps/:appName/performance` | `appPerformance`            | `project/apps/AppPerformance.tsx`             | Web-vitals p75. 404 when this app's own `kinds` lacks `beacon`                                                                                                                                                                                                                                                                                                                                                                                            |
| `/:projectSlug/apps/:appName/settings`    | `appSettings`               | `project/apps/AppSettings.tsx`                | Capabilities card (per-app `kinds`) + rotate / delete this app (owner-only server-side)                                                                                                                                                                                                                                                                                                                                                                   |
| `/:projectSlug/quests/:shortId`           | `projectQuest`              | `project/quest/QuestView.tsx`                 | Quest detail (param is the integer `shortId`, not a UUID)                                                                                                                                                                                                                                                                                                                                                                                                 |
| `/:projectSlug/quests/:shortId/graph`     | `projectQuestGraph`         | `project/quest/QuestGraph.tsx`                | Quest dependency graph                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/:projectSlug/folios`                    | `projectFolios`             | `folios/FoliosLayout.tsx`                     | The workspace with nothing open — tree + "no folio open" pane. The directory table (`FolioBrowser`) and its Recent Activity panel were deleted here: the tree is the only navigation now. Blob/activity ENDPOINTS are untouched, so blob support can return to the workspace without a server change                                                                                                                                                      |
| `/:projectSlug/folios/new`                | `projectFoliosNew`          | `folios/FolioCreatePage.tsx`                  | New folio                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `/:projectSlug/folios/:shortId`           | `projectFoliosFolio`        | `folios/editor/FolioWorkspace.tsx`            | Folio workspace — always-editable, summary/body, auto-saved. The old read-only `FolioView` + separate `/edit` route (`projectFoliosFolioEdit`) were merged into this one surface and the `/edit` route was deleted, not redirected                                                                                                                                                                                                                        |
| `/:projectSlug/settings`                  | `projectSettings`           | `project/settings/ProjectSettings.tsx`        | Settings layout (sub-routes below)                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/:projectSlug/settings/`                 | `projectSettingsBanner`     | `…/ProjectSettingsGeneralPage.tsx`            | General / banner                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/:projectSlug/settings/members`          | `projectSettingsMembers`    | `…/ProjectSettingsMembersPage.tsx`            | Members & pending invitations — the future home of per-member access rights                                                                                                                                                                                                                                                                                                                                                                               |
| `/:projectSlug/settings/areas`            | `projectSettingsAreas`      | `…/ProjectSettingsAreasPage.tsx`              | Areas config                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `/:projectSlug/settings/kanban`           | `projectSettingsKanban`     | `…/ProjectSettingsKanbanPage.tsx`             | Kanban columns config                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `/:projectSlug/settings/folios`           | `projectSettingsFolios`     | `…/ProjectSettingsFoliosPage.tsx`             | Folios config                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/:projectSlug/settings/feedback`         | `projectSettingsFeedback`   | `…/ProjectSettingsFeedbackPage.tsx`           | `features.feedback` toggle — the module's own page now, split out of the Sigils page                                                                                                                                                                                                                                                                                                                                                                      |
| `/:projectSlug/settings/sigils`           | `projectSettingsSigils`     | `…/ProjectSettingsSigilsPage.tsx`             | Sigil inventory — enrol (dialog) + list; master `features.sigils` toggle                                                                                                                                                                                                                                                                                                                                                                                  |
| `/:projectSlug/settings/milestones`       | `projectSettingsMilestones` | `…/ProjectSettingsMilestonesPage.tsx`         | Milestone config                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/:projectSlug/settings/quests`           | `projectSettingsQuests`     | `…/ProjectSettingsQuestsPage.tsx`             | Per-quest module toggles (chrono / reminder)                                                                                                                                                                                                                                                                                                                                                                                                              |
| `/:projectSlug/request`                   | `projectFeedbackRequest`    | `project/feedback/ProjectFeedbackRequest.tsx` | First-party feedback form (login required). Top-level, **not** nested under the `project` layout — no membership check                                                                                                                                                                                                                                                                                                                                    |
| `/account/feedback`                       | `myFeedback`                | `account/feedback/MyFeedback.tsx`             | A reporter's own submissions across all projects, declared in `src/web/app/components/account/LoreAccountRouter.ts` via `$pageAccount`, not in `AppRouter`. Detail is a drawer/sheet (`MyFeedbackEditSheet.tsx`), not a separate route — there is no per-feedback status page anymore. **The route name is deliberately still `myFeedback`**, not `accountFeedback`: it predates the `/account` migration and a `$page` rename is not typecheck-protected |
| `/account/invitations`                    | `accountInvitations`        | `account/MyInvitations.tsx`                   | Pending invitations addressed to the signed-in user. Also `$pageAccount`, group `Lore`                                                                                                                                                                                                                                                                                                                                                                    |
| `/*`                                      | `notFound`                  | `NotFound`                                    | —                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Also top-level under the shared layout: `/auth/login` (`login`), `/oauth/continue` (`oauthContinue`), `/auth/register` (`register`), `/auth/reset-password` (`resetPassword`).

HTTP API routes follow the same vocabulary: `/projects/:id/quests/export`, `/quests/attachments`, `/kanban/:projectId`, `/projects/:projectId/feedback`. MCP tools are `project_*`, `quest_*`, `milestone_*`, `folio_*` (also `directory_*` / `blob_*`), `feedback_*`, `blight_*`, `sigil_*`, `insights_*`.

### ⚠️ `/:projectSlug` is a **root-level** param — three consequences

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

### ⚠️ Deleting or renaming a `$page` is not typecheck-protected

`router.path("someRouteName", ...)` / `router.push("someRouteName", ...)` are typed against the live route table — but only while the name exists. The moment a route is renamed or removed, any call site still passing the old name silently widens to the plain `string` overload instead of erroring. The build stays green; the call throws at render time, in production, the first time a user hits that code path. This bit the 2026-08 rename directly (`campaignQuest` → `projectQuest` etc., and the whole `Kanban` board route disappearing in favour of `?view=kanban`). **Deleting or renaming a route name requires grepping the whole `src/` tree for the old string**, including nav arrays like `ProjectSettings.tsx`'s sidebar list and `ProjectView.tsx`'s `ROUTES_APP` set, which reference route names as plain strings with nothing in the type system tying them to the routes they name (see the comment on `projectSettingsSigils` in `AppRouter.ts`).

`test/app-routes.spec.ts` is the automated half of that guard, added with the Apps page: it boots the real router and resolves every name the app hands the router **as a plain string** — each `router.path(…)` / `router.push(…)` call site and each `route: "…"` nav array in `src/` — asserting both that the name resolves and that no `:param` is left unsubstituted. A deleted route is a red test rather than a production throw. It is not a census of the route table (a `$page` nobody navigates to by name is not in it, and does not need to be), and it is only as complete as its list: the spec carries the two greps that regenerate it, and a name added to a nav must be added there too.

## Key Patterns

### State Atoms

Live in `src/web/app/atoms/` (19 files). The project route loader fills the `current*` atoms on enter and clears them on leave — components inside the layout can read them without re-fetching. Three more atoms live in `src/api/atoms/` (`feedbackOptionsAtom`, `folioHistoryAtom`, `pinnedContentAtom`) — server-only tunables read by the backend, not route-driven.

**Per-project (set by `project` route loader)**

- `currentProjectAtom` — project metadata
- `currentProjectMemberAtom` — the viewer's membership row for this project
- `currentAssignedQuestsAtom` — quests assigned to the viewer
- `currentMilestonesAtom` — milestone list
- `currentFeedbackCountAtom` — pending-feedback badge for the project header
- `currentBlightCountAtom` — open-blights badge for the project header
- `currentQuestCountAtom` — open-quests badge for the project header (new: Quests has no feature gate, unlike Blights/Feedback, so this badge is always on)
- `currentSigilsAtom` — the enrolled apps the sidebar's Apps section lists. Fetched behind `.catch(() => undefined)`: reads are member-gated but a transient failure must cost the section, not the page. `undefined` (could not read) and `[]` (no apps yet) render differently — `[]` hides the Apps section entirely, `undefined` renders a "Couldn't load apps" entry instead

**Per-resource (set by their route loaders)**

- `currentQuestAtom` — active quest detail
- `currentFolioAtom` — active folio detail
- `currentSigilAtom` / `currentSigilInsightsAtom` — the open app and its analytics for the range its page currently shows. Atoms rather than loader props because the range toggle lives on the tab layout and `NestedView` cannot pass props to the tab it renders

**Folios index (set by the `projectFolios` loader)**

- `userFoliosAtom`, `folioTagsAtom`
- `projectDirectoriesAtom` — folio directory tree
- `currentFolioPathAtom` — breadcrumb chain for the active directory
- `currentFolioContentsAtom` — folios + blobs in the active directory

**Global (per-user, not per-project)**

- `userProjectsAtom` — sidebar/home project list

**Kanban ↔ Header communication (the pattern that needs explaining)**

- `kanbanProjectAtom` — set by `KanbanBoard` on mount with `{ project }`; read by the Header so the "Create Quest" button can target the right project
- `kanbanReloadAtom` — bumped by the Header's create button (`ProjectActionsCreateButton.tsx`) to trigger a board reload

Both live in the one file `atoms/kanbanProjectAtom.ts`.

### Kanban ↔ Header Communication

Kanban is not a route anymore — it's a second view of the `projectQuests` page (`ProjectQuestsPage.tsx` renders `KanbanBoard` instead of `ProjectQuestsTable`). `KanbanBoard` sets `kanbanProjectAtom` with `{ project }`. The Header reads it to:

1. Show the project name in the header (falls back from `currentProjectAtom`)
2. Show the "Create Quest" button

After creating a quest from the header, it bumps `kanbanReloadAtom` which `KanbanBoard` watches to trigger a reload.

**The view is an atom, not a query param.** `questsViewAtom` (`lor.quests.view`, cookie-persisted) is the single source of truth since #156. It was `?view=kanban` for exactly one iteration, seeded from `localStorage` by an effect on a bare `/:projectSlug/` — and that effect keyed on `useRouterState`, which is a global store, so it fired during the OUTGOING render of every navigation away from the page, saw the _next_ route's empty query, and bounced the user straight back. Every sidebar link was dead for as long as the board was the stored view. Moving the view out of the URL removes the question the page could not answer ("nobody has chosen yet" vs "we are leaving"). Cookie rather than `localStorage` persistence because `ProjectView` picks the layout during SSR, where web storage does not exist.

**The switch between the two views is not in the header.** It is `ProjectQuestsViewSwitcher.tsx`, a two-entry horizontal bar across the **top of the project content area** — rendered by `ProjectView` as the first child of that area and _outside_ the `showQuestLog / fullWidth / else` branch, so it sits above the Quest Log and holds the same y-position in list and board view (#153, axis rotated by #163 — it was a vertical left rail until then). It used to live inside `ProjectQuestsPage`, which necessarily put it _between_ the quest log and the table and made it read as a control for the table; no CSS inside the page could fix that, because a `NestedView`'s content is always right of the log. It renders on the same routes as the quest log (`projectQuests` **and** `projectQuest`) — dropping it on the detail route would shift the log up the moment a quest opened. Its entries carry visible labels rather than bare icons: a full-width band holding two icon buttons reads as unfinished in a way the narrow rail did not. It is gated on `project.features.kanban`: with kanban off it renders nothing rather than a single dead entry, and no empty band where it was.

### QuestView Reusability

`QuestView` works in two contexts:

1. **Project page** — rendered as a route (`/:projectSlug/quests/:shortId`), reads from `currentProjectAtom`, navigates via router
2. **Kanban drawer** — rendered inside a `Drawer`, receives `onClose` and `onQuestChange` callbacks

When `onClose` is provided, it's used instead of router navigation. When `onQuestChange` is provided, it's called on quest mutations so the parent can update its state.

### QuestCreate Navigation

`QuestCreate` accepts an optional `onCreated` callback. When provided, it's called instead of the default `router.push("projectQuest", ...)` after creating a quest. Used by the kanban header to stay on the kanban view.

### Project access model

Lore projects are private. Every project-scoped endpoint goes through
`AppSecurityProvider.assertMember` (member-or-owner) or `assertOwner`
(creator-only). There is no anonymous or "any-logged-in-user can browse"
path — the old `project.public` flag was removed (the column is kept in
the schema only because dropping it on D1 triggers a cascade-wipe).

The single exception is the feedback module: `submitFeedback` and
`uploadFeedbackAttachment` are gated on `project.features.feedback`
being on instead of membership, so any logged-in Lore user can submit
feedback to a project that opts in. The feedback module toggle is the
owner's opt-in/out lever.

### Drag & Drop

Uses `@dnd-kit/core`. Cards are `useDraggable`, columns are `useDroppable`. Status transitions: `new → accepted → completed`. Completed quests cannot be moved back. New quests must be accepted before completing.

## Feedback

User-submitted bug reports / feature requests that the project owner triages. (Renamed from **Petitions** in the 2026-08 great rename — same entity, same lifecycle, new name throughout code, DB, HTTP and MCP.)

**Lifecycle**: `pending → accepted` (promoted to one or more quests, each linked back via `quests.feedbackId` — there is no `promotedQuestId` column) `| rejected`.

**Submission flow (login required)** — both live entry points land on `POST /projects/:projectId/feedback`:

- `/:projectSlug/request` — first-party form on lore (`ProjectFeedbackRequest.tsx`, route `projectFeedbackRequest`). Anonymous visitors see a sign-in CTA. Once logged in, they get the full form (title, description, type bug/feature, file uploads).
- External "report a bug" buttons on third-party sites are plain `<a target="_blank" rel="noopener noreferrer">` anchors pointing to `/:projectSlug/request?path=<encoded>&url=<encoded>&type=bug` — no embedded JS, no screenshot capture, no widget. The page reads query params, persists them to `sessionStorage` (key `lor.feedback.draft.<projectId>` — renamed from `lor.petition.draft` in the same pass, unlike the storage bucket literals below, because this key is not a persisted external reference, just a transient client-side draft), cleans the URL via `history.replaceState`, and re-reads after the OAuth round-trip. Cleared on successful submit. `@alepha/sigil` builds this same request URL client-side as `${sink}/${project}/request`, reading the project out of its own `SIGIL_KEY` (tokens are shaped `sg_<project>_<secret>`), so an enrolled app's "report a bug" widget links out to it. **That shape is an external contract**: third-party apps construct it themselves now, which is what let the config round trip disappear. It also means a project rename breaks every enrolled app's feedback link until each key is rotated, where before a re-poll healed it. Reporting itself is unaffected by a rename, and by a key that names no project at all: the sink resolves the project from the token's hash and never from anything the app declares. `e2e/sigil.spec.ts` asserts the shape; it is the only thing that caught the URL still being id-based after the slug migration.

**Reporter-facing views** — `/account/feedback` (`myFeedback`, own submissions across projects, detail in a drawer/sheet). There is no separate per-feedback status page (the old one was retired before this rename).

**Attachments**

- Uploaded one-at-a-time via `POST /projects/:projectId/feedback/attachments`. Returns a file id; the client collects ids and includes them in the feedback body.
- Allowed types: png/jpg/jpeg/webp/gif/csv/txt/json/xlsx/xls/pdf. Both MIME and extension are checked (neither alone is trustworthy).
- 5 MB / file, 10 / feedback item.
- Stored in the `petition-attachments` bucket (`alepha/api/files`) — **kept un-renamed on purpose**: it's a value already persisted on every existing `files` row, not just an in-code identifier. Renaming it would orphan every attachment ever uploaded (the bucket lookup would 404 for files stored under the old name). The same reasoning keeps the folio-blob bucket at `archive-blobs` (see Folios section) and the project-icon bucket at `campaign-icons` un-renamed. The feedback row carries `attachments: uuid[]` (mirrors `quests.attachments`).
- `assertAttachmentsBelongToUser` blocks cross-user file id reuse — the controller verifies every claimed attachment was uploaded by the same user.

**Rate limits — `feedbackOptionsAtom`** (lives in `src/api/atoms/`, server-only)

- `maxFeedbackPerUserPerDay: 5` — per user, across all projects. Applies only to non-members; project owners/members submit without limit.
- `maxFeedbackPerSigilPerDay: 50` — caps the blast radius of a leaked sigil token being weaponized to flood the inbox.
- `maxAttachmentsPerUserPerDay: 50` — per user, across all feedback.
- `maxAttachmentsPerFeedback: 10`, `maxFileSizeBytes: 5 MB`.
- All counts are DB-derived (no in-memory windows) so they survive restarts and are correct across workers.

**Visibility / access**

- Submit: any logged-in Lore user (no membership required), provided the project has `features.feedback === true`. The feedback module toggle in project settings is the owner's opt-in/out lever.
- List/detail (read): any project member (`assertMember`). Triage — accept/reject/remove: project owner only (`assertOwner`). Same read-vs-mutate split applies to Blights and Insights (members can view the inbox / crash telemetry / analytics; owner-only actions stay gated).

**Where to look**

- Entity: `src/api/entities/feedback.ts`
- Controller: `src/api/controllers/FeedbackController.ts` (submitFeedback, feedbackContext, uploadFeedbackAttachment, listFeedback, getFeedback, getFeedbackAttachment, acceptFeedback, rejectFeedback, removeFeedback, listMyFeedback, listMyFeedbackProjects, updateMyFeedback, deleteMyFeedback)
- Rate limiter: `src/api/services/FeedbackRateLimiter.ts`
- Tunables atom: `src/api/atoms/feedbackOptionsAtom.ts`
- Inbox UI: `src/web/app/components/project/feedback/ProjectFeedback.tsx` (+ `ProjectFeedbackCard.tsx`, `ProjectFeedbackDetail.tsx`)
- Request UI: `src/web/app/components/project/feedback/ProjectFeedbackRequest.tsx`
- Routes: `projectFeedback` (under `project`), `projectFeedbackRequest` (top-level, not under the project layout — public landing), `myFeedback` (under the `/account` area, declared in `LoreAccountRouter`)

## Folios are this project's memory for Claude

Folios are markdown notes scoped to a **project** and shared across all its members (they were per-user before quest #65) — they mirror the `~/.claude/projects/*/memory/MEMORY.md` pattern but at the project level: persistent across sessions, exportable, fully MCP-readable. Treat them as the canonical place where any agent working on a Lore project should look for context and write down what it learns.

Since the 2026-08 great rename, Folios also absorbed the standalone **Archive** module — the directory tree + binary blobs that used to have their own URL path, entities (`archiveDirectories`/`archiveBlobs`/`archiveNames`) and MCP tool class (`ArchiveTools`). Folios live in a directory tree rather than nesting under each other. `folioDirectories` is the tree (depth-capped at 8), `folioBlobs` holds binary attachments, and `folioNames` backs name-uniqueness. `folios.directoryId` is `undefined` for the project root and **cascades on directory delete** — removing a directory removes everything in it, folios included. Surfaced at `/:projectSlug/folios` and over MCP via `FolioTools` (`directory_*`, `blob_*` tools live in this same file now).

**Conventions** (apply when curating folios — yourself or via Claude):

- One topic per folio. The title is the topic and the `summary` is the taxonomy — folios carry no tags (the tag feature was removed in feedback #62; `folios.tags` survives as a frozen dead column because dropping it would rebuild a table three others cascade from). Say what kind of note it is in the summary's first clause, since that is the line `project_context` shows.
- Keep folios short and self-contained. A folio that needs scrolling is two folios.
- When an agent creates a folio via MCP, it should always provide a `summary` (1-2 sentences, ~200 chars) so future `folio_list` / `folio_search` calls stay precise and `project_context` returns a self-explanatory index. It is the only orientation field there is now. Web-created folios may leave `summary` empty — the index falls back to the title.
- Use `[[Folio Title]]` or `[[#shortId]]` syntax inside a folio's markdown to cross-link other folios. Links re-sync on every save; agents see them as `links.outbound` / `links.inbound` on `folio_get` and humans see a Connections panel under the folio view.

**MCP orientation flow** (every AI client should follow this on a fresh task):

1. `project_context` — one-shot orientation: project metadata + active quests + folio index (~2K tokens, no folio bodies).
2. `folio_get` / `quest_get` on the specific entries that look relevant.
3. `folio_create` / `folio_update` when the agent decides something worth remembering long-term.

The MCP tool descriptions in `src/mcp/tools/ProjectTools.ts` and `src/mcp/tools/FolioTools.ts` are the public-facing version of this convention — every Claude reads them on connect. Keep them sharp.

**Where to look**

- Entity: `src/api/entities/folios.ts` (project-scoped, `searchText` blob for cheap LIKE search — blank for protected folios, `summary` for agent-readable orientation)
- Blob / directory entities: `src/api/entities/folioBlobs.ts`, `folioDirectories.ts`, `folioNames.ts`
- Link table: `src/api/entities/folioLinks.ts` (derived; re-synced from `[[...]]` references on every folio save)
- Link sync: `src/api/services/FolioLinkService.ts`
- Blob / directory services: `src/api/services/FolioBlobService.ts`, `FolioDirectoryService.ts`, `FolioNameService.ts`
- Controller: `src/api/controllers/FolioController.ts` (list, getByShortId, get, getLinks, create, update, delete, listProjectActivity, listHistory, revertHistory, pinHistory)
- Directory / blob controllers: `src/api/controllers/DirectoryController.ts`, `src/api/controllers/BlobController.ts`
- History: `src/api/services/FolioHistoryService.ts` (append, retention sweep, protection-domain purge)
- MCP tools: `src/mcp/tools/FolioTools.ts` (folio, directory and blob tools) + `ProjectTools.ts` (`project_context`)
- UI: `src/web/app/components/folios/editor/FolioWorkspace.tsx` (the workspace shell — three panes: folio tree (`editor/tree/`), document (`editor/document/`), inspector (`editor/inspector/` — Outline / History / Links tabs, the History and Links tabs absorbed the old `FolioHistoryPanel.tsx` / `FolioBacklinksPanel.tsx`, both deleted)), `FolioBrowser.tsx` and `FolioProtectedView.tsx` are both deleted — the browser with the directory view, the protected view as a long-standing orphan the workspace's own locked-folio gate had already replaced. Pane visibility, the 1280/1024px drawer breakpoints and focus mode (⌘.) live in `editor/useFolioPanes.ts`; find-in-folio (⌘F) in `editor/document/useFolioFind.ts`, which paints through the CSS Custom Highlight API (`::highlight(folio-find)` in `src/main.css`) rather than injecting `<mark>` elements — View mode's DOM is derived from the markdown on every render, so an injected node is discarded (and under the old Lexical body it would have been saved into the folio). ⚠️ **⌘F has two implementations**: `useFolioFind` serves VIEW mode only; in Edit mode `useFolioShortcuts` stands aside so `@codemirror/search` handles it, because CodeMirror virtualizes its viewport and a text-node walk silently misses every match scrolled out of sight. It is also keyed on the _rewritten_ content (`useFolioWikiLinks().rendered`), not the raw draft — the rewrite changes when the async quest fetch lands, replacing the pane's text nodes under any range the hook is holding
- E2E: `e2e/folio-workspace.spec.ts` is the whole folio surface now (summary round-trip, inspector tabs, tree drag-move, find, focus mode, pane persistence, the empty `/folios`, creating from the tree). `e2e/folios.spec.ts` was deleted with the directory table it drove. A tree drag is a fire-and-forget `update` — arm `waitForResponse` BEFORE the drop, or navigating cancels it in flight and the drop looks like it did nothing

**Bucket literals kept un-renamed** — `FOLIO_BLOB_BUCKET = "archive-blobs"` (`FolioBlobService.ts`, `LoreFileAccessProvider.ts`, `BlobController.ts`, `FolioBrowser.tsx`, `useFolioImageUpload.ts`). Same reasoning as the `petition-attachments` bucket in the Feedback section: it's a value already persisted on every existing `files` row, and renaming it would orphan every folio image/blob ever uploaded.

### ⚠️ Protected folios: the protection-domain invariant

A folio with `protected: true` stores a client-side `BrowserCryptoProvider` envelope in `content`. The server never sees the passphrase or the plaintext.

**Invariant: `folio_revisions` never holds a snapshot from a different protection domain than the folio's current one.** Crossing the boundary in either direction purges the folio's revision history (`FolioHistoryService.purgeRevisions`, called from `FolioController.update` when `isProtected !== existing.protected`).

This is a **confidentiality requirement**, not a tidiness one. Before it existed, encrypting a folio blanked `searchText` and wiped the outbound links but left every pre-encryption plaintext snapshot in `folio_revisions` — readable by any project member through `GET /folios/:id/history`. Encrypting protected nothing already written. It also meant `revertHistory` could write a plaintext snapshot into a folio still flagged `protected`, leaving it undecryptable in the UI.

`pinned` revisions are exempt from the retention sweep but **not** from this purge. Regression guard: `test/folio-protected-history.spec.ts`.

## Sigils, Blights, Beacon, Vitals

A **sigil** is one **app** that reports into a project: a free-form `name`, unique on `(projectId, name)`, and nothing else. It authenticates with a `sg_`-prefixed bearer token, stored hashed and shown once at creation; `tokenPrefix` exists so the UI can name a credential it cannot reconstruct.

> Until 2026-08-06 a sigil was "one environment of one application" — `app` + `environment` + a display `label`, unique on `(projectId, app, environment)`. The three columns collapsed into one `name` (migration `20260806093400_confused_dazzler`, hand-written and additive; see "Migration safety on D1" below). How finely to slice is now the operator's decision rather than the schema's: an app that wants staging kept apart from production enrols two sigils and names them so. Older notes and folios still use the old vocabulary.

Enrolled at `/:projectSlug/settings/sigils` (a dialog on a card-button, not an inline form) and administered per-app at `/:projectSlug/apps/:appName` (`SigilController`, reads member-gated, mutations owner-gated — no role, no allowlist: owning the project is the whole gate). `features.sigils` is the master switch. `blights` / `beacon` / `vitals` are **per-app**, the sigil's own `kinds` — set on that app's Settings tab, not a project-wide toggle. `feedback` is the one capability that still also answers to a project-level flag (`features.feedback`, its own settings page at `/:projectSlug/settings/feedback`): the same flag governs the first-party form at `/:projectSlug/request`, which exists with no app enrolled at all, so it can't live only on a sigil. A newly enrolled sigil carries all four kinds by default; `SigilController.updateSigil` (`PATCH /projects/:projectId/sigils/:sigilId`, owner-only) is the write path.

**Apps are a sidebar section, not a settings page.** Since 2026-08-06 the project sidebar carries a collapsible **Apps** group (gated on `features.sigils`) listing every enrolled app by name; each opens that app's own page. Rotate and delete live on that page's Settings tab — the settings page enrols and lists, and its rows link out. An empty project **hides the group entirely** rather than showing an "Enrol an app" placeholder — enrolling lives on the settings page, not the sidebar, so an empty group would have nothing to offer. A project whose list could not be read shows "Couldn't load apps" instead, because "empty" and "unreadable" are not the same claim. Past five apps the group stops opening by default (`defaultOpen: apps.length > 5 ? undefined : true`) — the shell then only reveals it when one of its descendants is active. The Blights sidebar entry follows the same data, plus one thing that outlives it: under the `features.sigils` master switch, it appears once some enrolled app's `kinds` carries `blights` **or** the project still has open blights. Both halves are load-bearing — `blights.sigilId` is `ON DELETE SET NULL` and rows are kept for `retentionDays ?? 30`, so dropping the capability (or deleting the last app) must not strand a triage queue that still exists behind a route that still resolves. The open-blight count is therefore fetched under `features.sigils` alone, not under the capability. The list reaches the sidebar through `currentSigilsAtom`, filled by the `project` route loader (defensively: `listSigils` is member-readable, but a failure costs the section, not the page).

**The gate is enforced on write, and only on write.** `SigilIngestService.gatesFor` reads the sigil's own `kinds` under the `features.sigils` master switch for `blights` / `beacon` / `vitals`, and additionally requires `features.feedback` for `feedback`. It used to have two callers — `absorb` and the `/sigils/config` advertisement — which had to agree. The advertisement is gone: an app declares what it collects in its own `SIGIL_CONFIG`, because a fetched config could survive neither a serverless isolate nor a prerender. That makes the write gate the whole story, which is the right half to keep: what a sender chooses to send is its business, what this sink keeps is ours, and a token that ignores everything still cannot write a kind its sigil withholds.

**Lore's own crashes reach the inbox through two paths, and one of them was silent until 2026-08-11.** Server-side failures are reported by `SigilServerErrors`, which listens on `server:onError` — emitted only by `ServerRouterProvider.errorHandler`, i.e. only for a route that fails as its own HTTP request. Anything failing inside `POST /api/_batch` was caught by that endpoint's `Promise.allSettled` and answered as a 200 with a per-entry error, so the event never fired. Since the React client batches by default and Lore's guarded pages are client-rendered, that was **every API failure the app ever had** — the inbox stayed empty through an outage in which every Insights read was 500ing. `ServerLinksProvider` now emits `server:onError` per failed entry (guards: `BatchEndpoint.spec.ts`, `SigilServerErrors.spec.ts`). Still open: a **pure client-side render crash** reports nothing at all — `NestedView` mounts `ErrorBoundary` with no `onError`, and React fires no `window.error` for what a boundary caught, so `SigilBrowserProvider` never sees it. See folio #82.

**Rotate, don't delete.** All four aggregate tables cascade on `sigilId`, so deleting a sigil to revoke a leaked token also erases that app's views, vitals, uniques and error groups. `rotateSigil` re-mints `tokenHash`/`tokenPrefix` in place — the old token stops resolving immediately (`verify` looks a sigil up _by_ its hash) and every row survives. The UI says which is which; so do the MCP tool descriptions.

- **Blights** — one row per distinct failure, keyed by `(projectId, fingerprint)`, with a count. The owner triages them in the inbox (`/:projectSlug/blights`): resolve, ignore-by-rule (`blightIgnoreRules`), or **forward to a quest** (filed under the `Blights` area, provenance recorded in `quests.source`). Purged on a retention window (`project.retentionDays ?? 30`) by `BlightJobs`; resolved and `quest:`-forwarded rows are kept as audit trail. A blight survives its sigil — `blights.sigilId` is `ON DELETE SET NULL`.
- **Insights** (`InsightsController`; the two beacon UI tabs 404 in the router when the open app's own `kinds` lacks `beacon` — see `AppRouter.ts`'s `assertBeacon()` — the endpoint itself is member-gated like any other project read, with no feature check of its own) — two segments over one payload: **Analytics** (page views, unique visitors) and **Performance** (web-vitals p75). Views and vitals are read through `alepha/api/analytics`'s `$analytics()` datasets — `sigil_views` / `sigil_vitals`, declared in `LoreAnalytics` (`src/api/entities/loreAnalytics.ts`) and asked via `views.query(...)` / `vitals.query(...)` — the same portable declaration that runs on a relational database, in memory for tests, and on Cloudflare Analytics Engine in production, with no backend-specific code in the controller (see the [Analytics guide](../../docs/1-guides/10-analytics.md)). `uniqueVisitors` stays on `sigil_uniques_daily` via `LoreAnalyticsStore`, because a distinct count cannot survive sampling or a rollup and so is out of `$analytics()`'s reach by construction. Buckets are hourly so a 14:00 deploy is visible against 13:00; the daily timeline is the dataset's `"day"` pseudo-dimension folding hour buckets with no epoch math on the controller's side, the same shape the old `substr(hour, 1, 10)` group produced. `uniqueVisitors` is the trustworthy headline — nothing throttles what an app reports, so `totalViews` is inflatable by whoever holds the token. The segments are the Analytics / Performance **tabs of one app's page**; `GET /projects/:projectId/insights?sigilId=` is what narrows them, and the id is verified to belong to the project in the path before it filters anything (member-gating is on the project, so an unchecked id would read another project's rows). Omitted, the endpoint still answers project-wide — which is what MCP's `insights_read` reads.
  - ⚠️ **`sigil_error_groups` is written and swept, and currently read by nothing.** The App ▸ Errors tab was its only reader and was removed in #178: with one enrolled app it duplicated the Blights inbox. It was not a duplicate by construction, though — it answered "is this still happening _in that app_", which the inbox cannot, because the inbox keys on `(projectId, fingerprint)` so a triage decision does not fork, and that necessarily merges every enrolled app into one row. The distinction is worth nothing at one app and returns at two.
    **The table is kept on purpose — do not delete it as unused.** Production holds ~1,086 rows across all four analytics tables, so the storage argument does not exist, and this is the only per-app error signal there is; dropping it would make the tab's return a migration instead of a revert. It stays on its own table rather than an analytics dataset because it keeps the _first_ stack sample, which needs a read before every write — something an append-only dataset cannot do.
  - **`sigil_views_hourly` / `sigil_vitals_hourly` are frozen, not deleted.** Both used to be the read path for Analytics/Performance and a dual-write target on ingest; both the read (this controller) and the write (`SigilIngestService`) moved onto the `$analytics()` datasets above, so nothing in the app reads or writes either table anymore. They stay declared purely so `yarn check:migrations` keeps agreeing with what is still physically on disk — `FrozenSigilAnalyticsTables` (`src/api/services/FrozenSigilAnalyticsTables.ts`) registers both entities directly with `DatabaseProvider` without handing any service a queryable repository on them, which is what keeps them in the migration snapshot instead of `check:migrations` proposing `DROP TABLE`. Actually dropping either table is a separate decision with its own migration review: `sigils` is the `ON DELETE CASCADE` parent of both (see "Migration safety on D1" below), so a rebuild migration here carries the same cascade-wipe risk as everywhere else in this file. When that review happens, `FrozenSigilAnalyticsTables` is what to delete first.

> ⚠️ **`name`, `message`, `stack`, `sourceUrl` on a blight are 100% attacker-controlled** and are shown to the project owner — the highest-value target. Render as escaped plain text only. Never markdown, never `dangerouslySetInnerHTML`.

Read endpoints are member-gated; mutations are owner-only. **Ingest has its own credential**: `POST /sigils/ingest` (`SigilIngestController`, `$route` so it sits at the root) accepts a sigil bearer token and nothing else — a logged-in member cannot post telemetry, and a sigil token opens nothing but that one route.

**The reporting half is a package, not an app.** `packages/@alepha/sigil` is what an enrolled app imports; it reads `SIGIL_KEY` (the token minted above) from env, plus an optional `SIGIL_SINK` and `SIGIL_CONFIG`, and aggregates errors by fingerprint before they leave the process. It used to poll `/sigils/config` for its appetite; that is now `SIGIL_CONFIG`, an optional bag of switches editable in a deploy dashboard without a rebuild. The two wire paths are one definition (`@alepha/sigil/paths`) imported by both ends — the client fails open, so a path disagreement is silent in both directions and has drifted once already. Lore sets a key naming itself: it is the sink, and a Cloudflare Worker cannot fetch its own hostname — `LoreSigilSinkProvider` substitutes the base `SigilSinkProvider` in `main.server.ts` to route Lore's own self-report in-process instead.

**Where to look**

- Entities: `src/api/entities/sigils.ts` (the credential + `(projectId, name)` unique index), `blights.ts`, `sigilErrorGroups.ts`, `sigilViewsHourly.ts`, `sigilUniquesDaily.ts`, `sigilVitalsHourly.ts`
- Owner CRUD: `src/api/controllers/SigilController.ts` (create / list / rotate / **update** — `kinds` only — / delete)
- App name rule: `src/api/schemas/appNameSchema.ts` (`APP_NAME_PATTERN` / `APP_NAME_MAX_LENGTH`; the entity column itself stays permissive, on purpose — see the comment there)
- Ingest: `src/api/controllers/SigilIngestController.ts` + `src/api/services/SigilIngestService.ts`
- Credential: `src/api/services/SigilTokenService.ts` (mint / verify / bearer)
- Triage: `src/api/controllers/BlightController.ts`, `src/api/services/BlightRuleService.ts`, `src/api/jobs/BlightJobs.ts`
- Analytics: `src/api/controllers/InsightsController.ts` (schemas extracted to `src/api/schemas/insightsResourceSchema.ts` / `sigilResourceSchema.ts` so the browser can validate the atoms without importing a controller)
- UI — enrolment: `src/web/app/components/project/settings/ProjectSettingsSigilsPage.tsx` (+ `…SigilRow`, `…SigilsEnrollDialog`), `shared/TokenReveal.tsx`
- UI — per app: `src/web/app/components/project/apps/AppLayout.tsx` (+ `AppDashboard`, `AppAnalytics`, `AppPerformance`, `AppSettings`, `AppSettingsCapabilities` — the per-app `kinds` switches); sidebar section in `project/ProjectView.tsx`; atoms `currentSigilsAtom` / `currentSigilAtom` / `currentSigilInsightsAtom`
- UI — feedback module toggle: `src/web/app/components/project/settings/ProjectSettingsFeedbackPage.tsx` (its own settings page now, split out of the Sigils page)
- UI — triage: `project/blights/ProjectBlights.tsx`
- MCP: `src/mcp/tools/SigilTools.ts`, `src/mcp/tools/BlightTools.ts`
- E2E: `e2e/sigil.spec.ts` — enrol → ingest → triage → open the app from the sidebar → tabs → rotate → delete, with ingest driven through Playwright's isolated `request` fixture (the page's `fetch` is patched to attach the session bearer, which would replace the sigil token)

## I18n

Two languages: English (`en`) and French (`fr`). All translations in `src/web/app/services/I18n.ts`. Always use `tr()` from `useI18n<I18n, "en">()` — never hardcode strings.

## De-gamification (2026-07)

Lore has **no gamification currency**: no XP, no gold, no levels, no achievements, no titles, no per-project alias/avatar. All of it was removed in two passes:

- First pass killed the wall: `FeaturePaywallService` / Shop / `requiredLevel` quest gating. Ex-walled features (Reports, Quest Reminder, …) are plain `project.features.*` owner toggles.
- Second pass removed the remaining cosmetic progression and collapsed `characters` into `members` (migration `20260730154120_heavy_nova`: `ALTER TABLE characters RENAME TO members` + column drops — no rebuild, D1-safe). `CharacterInfo`, `AchievementEngine`, `CharacterController`, the character sheet, roster, XP bar and level-up animation are gone.
- Third pass (2026-08-20) erased **quest difficulty and its F/C/B/A/S rank letters** — column, API, MCP, CSV export, UI. This section used to list the ranks under "what survives"; that is reversed. The audit behind it: `difficulty` was a **required** input nothing consumed — no report read it, nothing sorted or filtered by it, and Lore's own code invented the value (blight forwarding hardcoded `2`). The migration is the single statement `ALTER TABLE quests DROP COLUMN difficulty` (no index, no FK on that column, so SQLite takes it without a rebuild). CSV import still **accepts and ignores** a `difficulty` header, so pre-erasure exports round-trip.

What survives, deliberately:

- The RPG **vocabulary** for the work inside a project (quests, folios, blights, sigils) — flavor, not mechanics. **This is the whole of it**: the identity principle settled on 2026-08-20 is that Lore's RPG surface is vocabulary only, because "quest" names the agent-facing unit of work better than "task" (which can mean a markdown checkbox, a Jira ticket, anything). Mechanics are not identity. The container itself is deliberately _not_ RPG-flavored — see "The Lore of Lore" above for why it's `project`, not `campaign`.
- Two glyphs: `Swords` on Complete and `Signature` on Accept / "took the quest".
- `projects.unlockedFeatures` / `unlockHistory` / `public` and `quests.note` — **`@deprecated` dead columns**. Nothing reads or writes them; they stay because dropping a column on either table risks the D1 rebuild path, and both are CASCADE parents (`projects` is the one that wiped prod in 2026-05; `quests` cascades through its own `dependsOn` self-reference).

Do not reintroduce progression mechanics without an explicit decision — the goal is a neutral tool usable with other people; the metaphor describes the work, never the person.

## Key Dependencies

- `@dnd-kit/core` — drag & drop (kanban, quest board)
- **CodeMirror 6** (`@codemirror/{state,view,commands,language,autocomplete,search,lang-markdown}` + `@lezer/highlight`) — the Edit half of the shared markdown surface (`src/web/app/components/shared/markdown-editor/MarkdownEditor.tsx`), still lazy and client-only. It is a **View/Edit toggle**, not a WYSIWYG editor: View renders through `@alepha/ui`'s `MarkdownView`, Edit is raw markdown. Per-context image upload is unchanged (folios → folio blobs; quests → attachments, embedded ids merged server-side by `QuestService.mergeEmbeddedAttachments`), but an upload now inserts `![name](assets/x)` **as text** — no `<img>` is ever written, and there is no live resize. The feedback request form keeps a plain textarea (its own paste/drag attachment flow).
  - Default mode is **content-based**: a folio with content opens in View, an empty one in Edit; quest surfaces always start in Edit. See folio #33.
  - ⚠️ **`@mdxeditor/editor` and the whole Lexical tree were removed.** Anything you read describing a formatting toolbar, `renderToolbar`, an editor "realm", `useEditorRealmCommands`, `normalizeEditorMarkdown` or the `.lore-mdx` CSS predates this and is wrong. The reader-side `rehypeSafeImg` in `@alepha/ui` went with it, so **no raw HTML is rendered as markup anywhere** now.
  - ⚠️ **`yarn dedupe '@codemirror/*'` after touching these deps** — `yarn add` will happily resolve a second `@codemirror/view` alongside the nested copy other packages pin, and two copies means incompatible `KeyBinding` types and a typecheck failure in `keymap.of([...])`.
- `recharts` — reports charts
- `tw-animate-css` — generic enter/exit keyframe utilities used from Tailwind classes (replaces the old `animate.css`)

## Commands

```bash
yarn dev               # Dev server (HMR) on http://localhost:5173
yarn start             # Prod-like (build + node dist) on http://localhost:3000
yarn build             # Production build
yarn typecheck         # tsc --noEmit
yarn lint              # oxlint --fix, then oxfmt
yarn test              # vitest run
yarn e2e               # playwright test
yarn db:generate       # Generate new migration from entity changes
yarn v                 # Full verify pipeline (lint, typecheck, test, depcheck, db check, build, e2e)
yarn v --fast          # Inner-loop check: skip build + e2e (~30s)
yarn deploy            # alepha platform up -e production (Cloudflare D1)
```

## What's deployed? — `GET /version`

Every running instance exposes a public `/version` endpoint (`VersionController` uses `$route`, not `$action`, so it lives at the root instead of under `/api`) that returns the build stamp:

```bash
curl -s https://lore.alepha.dev/version
# {"version":"0.1.0","commit":"1f605e6","buildDate":"2026-05-17T21:10:42.808Z"}
```

Use it to confirm a deploy actually went live (vs. a stale Cloudflare cache) and to map a reported bug to the exact tip it runs against. The three values come from `alepha.config.ts`'s `env: { VITE_VERSION, VITE_GIT_COMMIT, VITE_BUILD_DATE }` block — Alepha pipes those into `process.env` at config load, and the server reads them in `VersionController`. The `VITE_` prefix also auto-exposes them to the browser bundle via Vite (`import.meta.env.VITE_VERSION` etc.) if frontend ever needs them.

The endpoint is public on purpose: Lore lives in the open-source `github.com/feunard/alepha` monorepo under `apps/lore`, so the commit SHA leaks nothing. `$route` (not `$action`) so it lives at the root path, not under `/api`.

## ⚠️ Migration safety on D1 (production-data bomb, real incident)

Lore deploys to Cloudflare D1, which **ignores `PRAGMA foreign_keys=OFF`**. Drizzle-kit's auto-generated SQLite migrations use the standard rebuild pattern (`CREATE __new`, `INSERT FROM SELECT`, `DROP old`, `RENAME`). On D1, the `DROP old` step triggers `ON DELETE CASCADE` on every referencing child row.

**This already cost us all of lore-production once** (2026-05-13, migration `0023_special_purifiers.sql` flipping campaign feature defaults — `DROP TABLE campaigns` cascade-wiped `characters`, `quests`, `chapters`, `folios`, `petitions`). Recovered from D1 backup. Tracked upstream as [drizzle-team/drizzle-orm#4938](https://github.com/drizzle-team/drizzle-orm/issues/4938), no fix shipped.

**Hard rule before pushing any commit that adds a new migration under `migrations/sqlite/`:**

1. `grep "^DROP TABLE" migrations/sqlite/<newest>.sql` — no match? Safe to push.
2. Match found? Identify the table, then `grep -rn "<table>.cols.id" src/api/entities/` to find children.
3. **If any child has `onDelete: "cascade"` referencing the dropped table, the migration is a bomb on D1. Do not push as-is.**

Mitigations, in order of preference:

- **Avoid the rebuild entirely.** If the only change is a column _default_ (the bomb we hit), move the default into the application handler — e.g. `createProject` injects `defaultProjectFeatures` server-side — and drop the `db.default(...)` from the entity schema. Drizzle won't generate a rebuild migration for an app-layer default.
- **Manually rewrite the migration** to back child rows up into `__bk_*` tables before the `DROP`, then re-insert and drop the backups after `RENAME`. Tedious but correct.
- **Temporarily switch the CASCADE child(ren) to `onDelete: "set null"`** for the migration window if the children make sense without a parent — only viable when the FK column is nullable.

**Why local testing won't catch this:** `yarn v` uses in-memory SQLite, where `PRAGMA foreign_keys=OFF` actually works. The bomb only goes off on D1. Inspect the migration SQL manually.

**CI auto-deploys to prod on every push to `main`** (alepha monorepo's `.github/workflows/ci.yml` → `deploy-lore-production` job → `yarn alepha platform up --env production` from `apps/lore`). There is no human gate between push and prod migration. Treat every D1 migration as you would a `DROP DATABASE` — read every line before pushing.

### What the 2026-08 great-rename migration got right (worked example)

`migrations/sqlite/20260805005114_green_captain_universe/` is a rename-only migration for the whole vocabulary rename — **6 table renames** (`campaigns`→`projects`, `petitions`→`feedback`, `chapters`→`milestones`, `archive_directories`→`folio_directories`, `archive_blobs`→`folio_blobs`, `archive_names`→`folio_names`) and 15 column renames, entirely via `ALTER TABLE ... RENAME TO` / `RENAME COLUMN`. **Zero `DROP TABLE`.**

drizzle-kit's auto-generator wanted to add a `projects` table _rebuild_ on top of the renames, because the `features` column's JSON `DEFAULT` embeds the old key names (`petitions`, `chapters`, …) baked in as a literal string, and those keys changed too. A rebuild there means `DROP TABLE projects`, which on D1 cascades through `members`/`quests`/`milestones`/`folios`/`feedback` — the exact class of incident described above. That block was **deleted by hand** from the generated migration, replaced with an explanatory SQL comment. This is safe _only_ because nothing reads the stale column default — `createProject` injects `defaultProjectFeatures` server-side in application code, so the column's `DEFAULT` clause is dead weight. The upshot: **the migration snapshot and the live `projects.features` column now deliberately disagree on that one default, forever** (or until a future migration touches that column for an unrelated reason). Do not "fix" this drift by generating a rebuild — that's the bomb, not the fix. `db:generate`/`db:check` will keep flagging it; that's expected, not a regression.

### ⚠️ Renaming a REQUIRED key inside a JSON column takes production down (real incident, 2026-08-05)

The rename above shipped green — `yarn v` passed, e2e passed, the migration was
rename-only with zero `DROP TABLE`, and prod data survived intact. Production
still broke on **every project read**, minutes after deploy:

```
SchemaValidationError: Invalid input: 'features/feedback' is required at /features/feedback
  → DbError: Query select has failed
```

`projects.features` is a JSON column validated against `projectFeaturesSchema`.
Four of its keys are **required** `z.boolean()` — `kanban`, `folios`, `feedback`,
`milestones` — while the rest (`sigils`, `blights`, `beacon`, `vitals`, the
`quest*` trio) are `.optional()`. The migration renamed the
_table and columns_, but the JSON **inside** the column still said `petitions`
and `chapters` on all 54 existing rows. A missing required key does not read as
`undefined` and fall back to `false` — **the whole row fails to decode**, so
every query touching `projects` throws.

The plan had predicted "the flags read as undefined → off, owners re-enable them
once." That reasoning came from the _optional_ flags and was never checked
against these four. Losing four toggles and losing every project read are not
the same failure.

**Nothing in the pipeline could have caught it.** Test and CI databases are
created empty from the entities, so every row they contain is already in the new
format. Only a database with pre-rename rows can fail this way, and there is
exactly one of those.

Fixed forward by rewriting the JSON in place, preserving each owner's real
setting rather than defaulting anything off:

```sql
UPDATE projects SET features = json_remove(
  json_set(features,
    '$.feedback',   CASE WHEN json_extract(features,'$.petitions')=1 THEN json('true') ELSE json('false') END,
    '$.milestones', CASE WHEN json_extract(features,'$.chapters') =1 THEN json('true') ELSE json('false') END
  ), '$.petitions', '$.chapters')
WHERE json_extract(features,'$.feedback') IS NULL
   OR json_extract(features,'$.milestones') IS NULL;
```

The `CASE … json('true')` is load-bearing: `json_extract` on a JSON boolean
returns integer `1`, so a naive round-trip writes `1` and the row _still_ fails
`z.boolean()`.

**The rule:** renaming a key inside a JSON column is a data migration, not a
schema migration. Before renaming one, check whether it is required — and if it
is, carry the `UPDATE` in the same deploy. Making the key `.optional()` instead
would also stop the crash, but silently discards the owner's setting; prefer the
rewrite. This was run as a one-off against prod rather than as a migration file
because Lore has exactly one instance and a fresh database starts empty.

### ⚠️ `ADD COLUMN … NOT NULL` is green on every database except production (2026-08-06)

Folding `sigils.app` + `environment` + `label` into a single `name`
(`20260806093400_confused_dazzler`), drizzle-kit generated:

```sql
ALTER TABLE `sigils` ADD `name` text NOT NULL;
```

**SQLite refuses this on any table that has rows** — _"Cannot add a NOT NULL column
with default value NULL"_ — and accepts it on an empty one. Every database CI, `yarn v`
and the test suite construct is empty, so the statement is green everywhere it is ever
exercised and fails only against the single database that has data. It is the same
blind spot as the JSON-key incident above, from the opposite direction: there, empty
databases hid a row that could not decode; here they hide a statement that cannot run.
The blast radius is smaller — D1 applies a migration as one transaction, so this is a
failed, rolled-back deploy rather than data loss — but nothing in the pipeline goes red
first.

The shape that works, and the one to reach for whenever a new column must end up
`NOT NULL`:

```sql
ALTER TABLE `sigils` ADD `name` text;--> statement-breakpoint          -- nullable
UPDATE `sigils` SET `name` = substr(`label`, 1, 100);--> statement-breakpoint  -- backfill
-- …de-duplicate, swap indexes, then DROP the old columns LAST
```

Add nullable, backfill from a column that is already `NOT NULL`, and let the entity
schema carry the constraint. Order matters beyond the constraint: SQLite refuses to drop
a column an index still references, so the index swap precedes every `DROP COLUMN`.
Also note drizzle emitted no backfill at all — it dropped `label` without carrying it
anywhere, which would have left every existing sigil nameless before handing them to a
`UNIQUE` index. Read generated migrations for what they _omit_, not only for `DROP TABLE`.

**The drift this leaves behind is deliberate — do not "fix" it.** `sigils.name` is
physically nullable on D1 while the snapshot declares it `NOT NULL`, because SQLite
offers no way to add a `NOT NULL` column to a populated table without also inventing a
`DEFAULT` the snapshot does not have. It cannot cause `check:migrations` drift —
drizzle diffs the entity against the **snapshot**, never the live database — so this is
invisible to tooling and lives only here and in the migration's own comment block. The
only way to make the physical column match is a table rebuild, and `sigils` is the
`ON DELETE CASCADE` parent of `sigil_views_hourly` / `sigil_uniques_daily` /
`sigil_vitals_hourly` / `sigil_error_groups` — so that "fix" is the bomb at the top of
this section. Same precedent, same verdict as the `projects.features` `DEFAULT` drift
documented above: accepted drift beats a rebuild. `test/migration-safety.spec.ts` guards
the table against a future `DROP TABLE` from the family rebuild forward.

### ⚠️ A table registered only under one runtime gets a migration under neither (2026-08-11)

Every Insights read 500'd in production — so every `/:projectSlug/apps/:appName` page
rendered the generic ErrorPage — because `analytics_prune_floors` did not exist
on D1. `WaeAnalyticsProvider.query()` reads that table before _every_ read.

`alepha/api/analytics` registered it only from `WaeAnalyticsProvider.register()`,
deliberately: only the Analytics Engine backend needs a prune floor (WAE has no
delete API), so a plain relational deployment was spared a table it can never
read. That gate made **the set of tables the app declares a function of the
runtime it booted under**, and the two runtimes are not the same one:

- `yarn db:generate` runs on **Node**, where `index.ts` selects
  `OrmAnalyticsProvider` → the table entered no snapshot and no migration.
- Production runs **workerd**, where `index.workerd.ts` selects
  `WaeAnalyticsProvider` → it reads a table nothing ever created.

Same blind spot as the two entries above, third mechanism: not an empty test
database, a _different runtime_. `yarn test`, `yarn typecheck` and
`yarn check:migrations` all run on the side where the table is not declared, so
none of them could have gone red. Fixed in the framework —
`OrmAnalyticsProvider.register()` now registers it unconditionally — plus
migration `20260810222423_tidy_ozymandias` (bare `CREATE TABLE`, D1-safe).

**It was not alone.** Four faults sat on this one code path, each hidden behind
the one in front of it, so each fix revealed the next and every "is it fixed?"
answered itself with a new error:

| #   | Fault                                                   | Fix                                          |
| --- | ------------------------------------------------------- | -------------------------------------------- |
| 1   | `analytics_prune_floors` missing on D1                  | register the table unconditionally           |
| 2   | `CLOUDFLARE_ANALYTICS_TOKEN` never pushed to the Worker | add it to the build manifest's env allowlist |
| 3   | `HAVING COUNT(*) > 0` → 422                             | `count()`, which takes no arguments          |
| 4   | `GROUP BY substring(blob2, 1, 10)` → 422                | group by the projected alias                 |

**#1 and #2 are the same root cause.** The secret push is filtered by the build
manifest's `env` list, which comes from `alepha.dump().env` — the graph as
instantiated under node — and `CLOUDFLARE_ANALYTICS_TOKEN` is declared by
`WaeAnalyticsProvider`, which exists only under workerd. So `platform up`
dropped the key from every push while reporting success. A missing secret is
worse than a missing binding: it fails at request time, not at boot, so the
deploy is green and the feature is dead.

**#3 and #4 are a different lesson: the test fake agreed with the bug.**
`FakeAnalyticsEngine` was written to mirror the SQL `WaeAnalyticsProvider`
generates, so it accepted whatever that SQL said — including two statements the
real Analytics Engine parser rejects outright. Teaching the fake the _parser's_
rules instead turned 28 of 43 WAE specs red immediately. A fake that mirrors
generated SQL can never disagree with it; only one that mirrors the parser can.
And validate against the real endpoint **before** fixing: #3 and #4 shipped a
deploy apart purely because the first error masked the second.

**The rule:** schema must not vary by runtime. Migrations are generated under one
and applied under another, so anything registered behind "which provider did we
select" exists in exactly one of the two. To check a suspicion of this class,
diff what the snapshot declares against what production actually has:

```bash
npx wrangler d1 execute lore-production --remote --json --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

The companion defect — why no blight was ever raised for any of it — is under
"Sigils, Blights, Beacon, Vitals" above; both are written up in folio #82.

### ⚠️ Dropping a conjunct from a gate is a data migration with no SQL (accepted, 2026-08-06)

Moving telemetry capabilities off the project's feature flags and onto each app's
own `sigils.kinds` changed what `SigilIngestService.gatesFor` computes:

```ts
// before
views: master && features.beacon === true && carries(sigil, "beacon");
// after
views: master && carries(sigil, "beacon");
```

Same for `errors` (`features.blights`) and `vitals` (`features.vitals`). Only
`feedback` still carries a project flag, because `features.feedback` also governs
the first-party form at `/:projectSlug/request`, which exists with no app enrolled.

**Removing a conjunct is monotone in the "on" direction.** No sigil loses a
capability; some gain one. A newly minted sigil carries all four kinds, and
`ProjectCreate.tsx`'s `DEFAULT_FEATURES` never set `blights` / `beacon` / `vitals` —
so on every wizard-created project those flags are _absent_, the old `=== true`
conjunct was false, and ingest was **silently discarding** everything those apps
sent. The moment this deploys the same payloads are accepted: page views, web
vitals, error groups, blights, and the daily visitor hash in `sigil_uniques_daily`
— the one piece of personal data on this path. Enrolled apps never stopped
sending — they read their own `SIGIL_CONFIG` and know nothing of this — so the
write gate reopening is enough. No owner action, no notification, no migration
file in the diff.

**No SQL runs. The rows do not change — the meaning of `kinds` does.** That is
what makes this easy to miss: `check:migrations` is green, `migrations/sqlite/` is
untouched, and every test constructs its own fixtures so nothing goes red. There is
no artifact anywhere in the pipeline that says data behaviour changed.

**This was decided, not overlooked.** It was acceptable here because production
holds a single sigil — `lore` — enrolled by the operator into their own project, so
the set of people whose telemetry starts flowing is the operator's own visitors
under a project the operator controls, and the new behaviour is the intended end
state rather than a leak to be corrected. Writing an `UPDATE sigils SET kinds = …`
migration to strip the newly-effective kinds was considered and rejected: it would
have frozen every app into the retired flags' accidental values and left an owner
with switches whose default disagreed with the design.

**The rule.** A gate is a data-behaviour surface. Dropping a conjunct from one —
or widening any authorization or ingest predicate — is a semantic data migration
even when no schema changes and no SQL is written, and it belongs in this register
next to the ones that do. Before merging such a change, answer: which existing rows
change meaning, what starts being written that was not, does any of it include
personal data, and would the affected owner want to be told. If the answer to the
last one is yes and nobody is telling them, write the `UPDATE` instead.

### ⚠️ `$sequence` keys its counter on the property name, not the table

`$sequence()` fields (used for per-project short IDs / numbering, e.g. `MilestoneController.milestoneNumber`, `FeedbackController.feedbackShortId`) persist their running counter in the `alepha_sequences` table, keyed by **the property name**, not by the entity/table it numbers. Renaming the property — `chapterNumber` → `milestoneNumber`, `petitionShortId` → `feedbackShortId` — does not rename the existing counter row. It orphans it: the renamed property starts a brand-new counter at 1, colliding with whatever numbers already exist in production for that project.

This is exactly what would have happened silently in the 2026-08 rename if the migration hadn't carried two explicit statements to repoint the existing rows:

```sql
UPDATE alepha_sequences SET name = 'milestoneNumber' WHERE name = 'chapterNumber';
UPDATE alepha_sequences SET name = 'feedbackShortId' WHERE name = 'petitionShortId';
```

**No test catches this.** Test databases start with an empty `alepha_sequences` table, so a missing `UPDATE` is invisible in `yarn test` and only surfaces against a production database that already has rows. Any future rename of a `$sequence`-backed property needs the same treatment — check `alepha_sequences` for the old name and carry an `UPDATE` in the migration.

## ⚠️ The Cloudflare WAF rule on `/sigils/` has a job again — keep it

**This section previously said the rule was dead weight and told you to delete
it. That was true while nothing served `/sigils/`. It is false now — do not
delete it.**

Lore is a telemetry sink again, and `/sigils/ingest`
(`SigilIngestController`, `$route` so it sits at the root rather than under
`/api`) is publicly reachable by construction: apps report to it from every
machine they run on. They authenticate with a bearer sigil token and answer 401
to anything else — but an unauthenticated caller still costs a request, a token
lookup and a SHA-256, and the token itself sits in cleartext on every host that
runs the reporting app, so a leaked one is a plausible flood.

There is **no in-app rate limiter on this path**. The old `sigil_blight_rate`
table was dropped in the sigil-family rebuild and nothing replaced it. The
Cloudflare rate-limiting rule is currently the only thing in front of these two
endpoints.

**Where it lives** — the dashboard, not code, so it will not reappear from a
deploy if someone removes it: `lore.alepha.dev` zone → Security → WAF → Rate
limiting rules → the rule matching
`http.request.uri.path contains "/sigils/"`.

If an in-app limiter is ever added, this rule stays anyway: the point of an edge
rule is that the flood never reaches the Worker.

## Tests

### ⚠️ Two vitest configs, and neither runner can catch what the other is missing (2026-08-06 / 2026-08-09)

**Verify with `yarn test` from the repo root.** That is what CI runs, and the workspace command does not stand in for it.

The root `vitest.config.ts`'s "node" project has no `include` filter (removed to keep WebStorm happy), so it collects every spec in the repo — lore's included — under the _root_ config. `apps/lore/vitest.config.ts` is never consulted from the root; it only applies to `yarn w lore test`. **One hazard, two faces** — it has now produced a red suite in each direction, and the direction is not the lesson:

**Face 1 — root red, workspace green (`@/` alias).** It stayed hidden because no lore spec had ever imported `AppRouter.ts`, which is the first thing that reaches `@/`-aliased app source transitively. `test/app-routes.spec.ts` did, and died at import time under `yarn test` (`Cannot find package '@/api/schemas/…'`) while passing under `yarn w lore test` — the `@/` alias it needed had just been added to `apps/lore/vitest.config.ts`, the one file the workspace command loads and the root command ignores. The command used to verify the fix was structurally incapable of failing on it.

**Face 2 — workspace red, root green (`execArgv`).** `useFolioPanes.browser.spec.tsx` failed all 8 cases under `yarn w lore test` with `Cannot read properties of undefined (reading 'clear')` on `window.localStorage.clear()`, and passed under `yarn test`. Node ≥ 25 ships a native Web Storage global; vitest's jsdom environment will not overwrite a global that already exists, so the unbacked native `localStorage` shadows jsdom's real `Storage`. The root config disables it with `execArgv: ["--no-experimental-webstorage"]`; the app config had never grown the line. CI runs the root command, so CI was green and had always been green — the failure only ever appeared under the command a developer working inside `apps/lore` reaches for first.

Both are the same shape as the `ADD COLUMN … NOT NULL` trap below — a check that could not have gone red — with a different mechanism: wrong runner, not empty database.

**The fix for face 2 was structural, not the missing line.** The browser project now lives in `vitest.jsdom.ts` at the repo root and both configs call `jsdomProject(include)`, each supplying nothing but its own `include`. Add a jsdom setting there, never to a caller. Guarding the spec instead (`window.localStorage?.clear()`) was rejected: it would pass while still running in the wrong environment, so every assertion about persisted pane preferences would be testing nothing.

The `@/` alias is still duplicated in both configs, and the root copy is load-bearing: `apps/examples/playground` and `apps/examples/shop` declare the same `@/* → ./src/*` tsconfig mapping without writing a single `@/` import today, so the first one added in either app resolves into `apps/lore/src` under a root run — typecheck green, wrong file imported. At that point the repo-wide alias has to become per-project, which is why it is not shared the way the jsdom project is.

57 unit / integration specs in `test/` (Vitest, in-memory SQLite). Notable ones:

- `mcp-security.spec.ts` — MCP auth, API keys, user isolation
- `project-reports.spec.ts` — reports aggregation
- `project-leave.spec.ts` — `leaveProject` (owner-forbidden, no-op, member removal)
- `project-features.spec.ts` — `project.features` toggle behavior + defaults
- `project-owns-guard.spec.ts` / `project-relations.spec.ts` — `$owns` gating and relational reads
- `milestone-jobs.spec.ts` — milestone background work (open/close, scheduling)
- `quest-csv-*.spec.ts` — generic + format-specific CSV import/export, plus the Trello round-trip
- `quest-objective-history.spec.ts` — objective state history tracking
- `quest-reminder.spec.ts` — quest reminder/notification logic
- `quest-feedback-link.spec.ts` — feedback-to-quest promotion linkage
- `feedback-attachment.spec.ts` / `feedback-rate-limit.spec.ts` / `feedback-source.spec.ts` — the Feedback module (attachments, rate limits, `source` provenance)
- `my-feedback.spec.ts` — reporter-scoped `/me` feedback endpoints
- `folio-protected-history.spec.ts` — **regression guard**: the protection-domain invariant (no plaintext left in `folio_revisions` after encrypting; pinned revisions are not exempt)
- `folio-*.spec.ts` — links, backlinks, tidy, pinning, permissions, history, activity, blob links, directories (the old Archive-module coverage lives here now too)
- `sigil-controller.spec.ts` / `sigil-ingest.spec.ts` / `sigil-entities.spec.ts` / `sigil-self-report.spec.ts` — sigil CRUD + rotation, token verification, capability gating, aggregate upserts, and Lore's own in-process self-report path
- `sigil-jobs.spec.ts` — the analytics collapse sweep: the uniques hash-fold, the hourly→daily view fold, idempotency across re-runs, and what Insights reads on either side of a sweep. Drives `DateTimeProvider.travel()` over the window boundary, so it asserts end state and never call counts
- `insights-controller.spec.ts` / `insights-tools.spec.ts` — beacon/vitals windows and the p75 walk (clock pinned with `DateTimeProvider.pause()`), the `?sigilId=` per-app filter including the cross-project refusal, plus the MCP surface
- `app-routes.spec.ts` — **regression guard**: boots the real `AppRouter` and resolves every route name the app passes the router as a plain string (every `router.path`/`push` call site and every `route: "…"` nav array in `src/`, including `ProjectSettings.tsx`'s — the array that broke once). `router.path()` takes `keyof VirtualRouter<T> | string`, so a deleted or renamed route is never a type error — this is the only thing that turns it into a red test instead of a production throw. Also asserts that **every static root segment in the route table is reserved** in `ProjectSlugService` — the invariant `/:projectSlug` creates
- `project-slug-service.spec.ts` / `project-slug-controller.spec.ts` — slug derivation (accent folding, separator collapse, the reserved list and the `project-<id>` fallback) and its lifecycle: derived on create, recomputed on rename, 409 on a taken name across _any_ owner, freed on delete
- `project-slug-migration.spec.ts` — **regression guard**: reads the backfill migration for `DROP TABLE` / `ADD COLUMN … NOT NULL`, then actually _applies_ it to a seeded database and asserts the slugs that come out (collision, accented title, CJK title, soft-deleted row). `migration-safety.spec.ts` stops at earlier migrations, so nothing else executes this SQL
- `user-deletion-hook.spec.ts` — **regression guard**: `UserDeletionHook` refuses `deleteMyAccount` while the account still owns projects, and the account survives the refusal. Load-bearing because `projects.createdBy` is a bare `z.uuid()` with **no foreign key** — deleting an owner cascades nothing and warns about nothing, leaving a project pointing at a row that no longer exists and failing `assertOwner` for everybody. Nothing in the schema, the types or the migration snapshot can catch that. Also pins that the hook's message reaches the client as a 409 with its text intact (`MyAccountController` emits without `{ log: true }` precisely so it does)
- `blight-tools.spec.ts` — the MCP triage surface
- `migration-safety.spec.ts` — asserts the great-rename migration (and the sigil-family rebuild before it) never drops a table the `projects` cascade reaches, and that a fresh D1-shaped database boots with all migrations applied
- `petition-reporter-migration.spec.ts` / `petition-reporter-restore-migration.spec.ts` — deliberately still "petition"-named: they pin the behavior of two specific _historical_ migrations (`reporterUserId`/`reporterEmail` column churn) that predate the 2026-08 rename, not the current Feedback module
- Shared fixtures live in `test/fixtures/`

### ⚠️ Running e2e while another agent is running it

This suite used to run on **3303 — the same port as `yarn dev`**. With `reuseExistingServer` on, a dev server left running in another terminal was adopted by Playwright, and the whole suite ran against hot-reloaded sources and the dev database instead of `node dist` and `:memory:`. Two agents in two worktrees hit the same trap through each other's servers.

`e2ePort("lore")` in the repo-root `playwright.port.ts` — shared by all six Playwright configs, same pattern as `vitest.jsdom.ts` — makes both impossible. E2E allocates from a reserved **4300-4999** band that no dev server may use; within it the slot is derived from the **checkout path**, so two worktrees never meet; and the port is then **bind-tested**, stepping a full stride if anything answers. `reuseExistingServer` is `false` everywhere as a result: a port verified free has nothing legitimate to adopt.

`E2E_PORT` overrides the whole thing, probe included. Reach for it when the allocation cannot help — most often a worktree checked out _before_ this landed, which still carries the old fixed-3303 config. Pick something inside the e2e band:

```bash
E2E_PORT=4999 npx playwright test quest.spec.ts
```

Before killing anything on a busy port, check whose it is — `lsof -a -p <pid> -d cwd`. A `node dist` whose cwd sits under `.claude/worktrees/` belongs to another agent's run.

### E2E convention: one file per feature

`e2e/` is split by feature, not by user journey. One `<feature>.spec.ts` per major surface, each covering happy path + key edge cases:

- `sigil.spec.ts` — enrol an app → ingest as it → triage in the inbox → open the app from the sidebar's Apps section → walk its tabs → rotate → delete
- `blights.spec.ts` — regression guard for the inbox render loop (the ingest path lives in `sigil.spec.ts`)
- `quest.spec.ts` — quest lifecycle (open → accept → complete) + reminder UI
- `quest-comments.spec.ts` — the Discussion: post / list / edit / delete and the membership gate
- `feedback.spec.ts` — feedback submit → accept → link quests → status progression (renamed from `petition.spec.ts`)
- `register.spec.ts` — registration form + email verification
- `settings-features.spec.ts` — project feature toggles
- `theme-flicker.spec.ts` — theme no-flash boot
- `invitation.spec.ts` — owner invites → user accepts → joins project as a member (drives the email-link round-trip)
- `protected-folio.spec.ts` — end-to-end encrypted folios (passphrase round-trip, wrong-passphrase rejection, no plaintext on the wire)
- `quest-import-export.spec.ts` — Data settings page CSV export (import side is covered by the unit specs)
- `folios.spec.ts` — directory tree navigation + blob upload (renamed from `archive.spec.ts`)
- `project-wizard.spec.ts` — 3-step create wizard (renamed from `campaign-wizard.spec.ts`)
- `members.spec.ts` — settings members list, identity hover-card, dead `/character` + `/roster` URLs 404
- `account.spec.ts` — the `/account` area (Lore's consumer of `@alepha/ui`'s `AccountRouter`): lands on the profile, the rail lists the five built-in pages **and** Lore's two `$pageAccount` ones, rename round-trip, password change, sessions, API-key create/reveal-once/revoke, and delete-account refused while a project is owned. ⚠️ The rename test waits for the success toast **before** reloading — without it the reload races the save and the assertion fails for the wrong reason
- `home.spec.ts`, `admin-user-detail.spec.ts`
- `security-public-project.spec.ts` — regression guard: non-member account hits 403 on every project endpoint after the public-project purge (renamed from `security-public-campaign.spec.ts`)
- `security-file-access.spec.ts` — regression guard: `/api/files/:id` IDOR fix via `LoreFileAccessProvider` (only owners/members can download an attachment)
- `project-slug.spec.ts` — the URL identity: the wizard lands on a slug derived from the title, renaming shows the confirmation and moves the URL (cancel reverts the field), the old slug 404s, `/p/:id` 404s, and a taken name is refused with a visible message. ⚠️ The Name field does **not** auto-commit — the form has a real Save button in the settings card's last row, disabled until something is dirty. A spec that only types saves nothing

Shared setup (register/verify, project-create wizard, API helpers) lives in `e2e/_helpers.ts`. Re-use those rather than copy-pasting auth setup into each new spec.

`setProjectFeature(page, projectId, key, value?)` flips a project feature toggle from inside a flow — use it when a spec needs an off-by-default module (e.g. `questReminder`). It replaced the old `unlockShopFeature`, which farmed gold from a throwaway quest to fund a Shop purchase; the Shop no longer exists.

**When adding or modifying a feature, the matching `<feature>.spec.ts` must move with it.** No feature ships without its e2e moving in lockstep. If no spec exists yet for the feature, create one — start by composing `registerAndVerify` + `createProjectViaWizard` from `_helpers.ts`, then drive the feature-specific UI.

## Manual testing via Playwright (Claude)

When you need to drive the app yourself with the Playwright MCP, use these shortcuts.

### Servers

| Mode                        | Command      | URL                   | Database                                               |
| --------------------------- | ------------ | --------------------- | ------------------------------------------------------ |
| **Dev** (HMR, no build)     | `yarn dev`   | http://localhost:5173 | `node_modules/.alepha/sqlite.db` (persistent)          |
| **Prod-like** (build + run) | `yarn start` | http://localhost:3000 | in-memory (`DATABASE_URL=:memory:`) — wiped on restart |

Dev mode is what you usually want — it keeps state between runs and emails accumulate on disk.

### ⚠️ Prod-like is not production — only workerd is

| Mode         | Runtime       | Catches                               |
| ------------ | ------------- | ------------------------------------- |
| `yarn dev`   | Node + Vite   | most things                           |
| `yarn start` | Node, bundled | bundler/env issues                    |
| **wrangler** | **workerd**   | **isolate limits, Workers-only APIs** |

The third row is not optional for anything that smells production-only. Quest #132 (folio page → error boundary in prod) was investigated once and closed as "not reproducible": dev fine, `node dist` fine, SSR already off. All true, and all irrelevant — the bug was an isolate crash, and neither Node mode runs an isolate. Under wrangler it reproduced on the first try.

```bash
yarn alepha platform build -e production
```

Then, in `dist/`, copy `wrangler.jsonc` to `wrangler.local.jsonc` with `routes` and `send_email` removed and `APP_SECRET` set in `vars`, and:

```bash
npx wrangler dev --config wrangler.local.jsonc --local --port 8788
```

`--local` is what keeps the D1/R2/KV bindings simulated. **Never drop it** — the config carries the real production `database_id`.

Traps, all of which cost time once:

- **The local D1 starts empty.** `alepha platform build` wipes `dist/`, and `dist/.wrangler/state` with it, so this is needed after every rebuild:
  ```bash
  for d in migrations/sqlite/2*/; do sed 's|--> statement-breakpoint|;|g' "$d/migration.sql"; echo ";"; done > /tmp/all.sql
  npx wrangler d1 execute DB --config wrangler.local.jsonc --local --file=/tmp/all.sql
  ```
- **No email.** Registration still works: the verification code sits in plaintext in the job payload —
  `SELECT payload FROM job_executions WHERE job_name LIKE '%notification%' ORDER BY rowid DESC LIMIT 1`.
- **Sessions expire in 15 minutes.** A batch of `curl`s that suddenly all return 302 means the token aged out, not a regression.
- **Measure bytes, not status codes.** A crashed isolate still returns `200` — the early head has already been flushed. The signal is a truncated body: ~300 bytes with no `</html>`, versus ~21KB for a healthy page.
- **Restart between probes.** Once an isolate dies, every later route on that instance looks broken too. Diagnosing without a restart makes one broken route look like six.

### Accounts

The realm admin (`.env` → `ADMIN_EMAIL=admin@alepha.dev`) is auto-bootstrapped on first start. Use that for owner/admin flows.

To test a fresh signup:

1. POST `/auth/register` via the UI with a throwaway email like `feat$(date +%s)@example.com`.
2. The verification email lands as a JSON file in `node_modules/.alepha/emails/<email>,<timestamp>.eml.json` — open it, grab the `verify` URL from the HTML body, and load it in the browser to confirm.
3. Same flow for password reset (`/auth/reset-password`).

### Mail inbox

There's no SMTP — dev mode persists every sent email as JSON under `node_modules/.alepha/emails/`. Filename is `<recipient>,<ISO timestamp>.eml.json`. Read with `cat`/`jq`, scrape links with `grep -oE 'href="[^"]+"'`.

### Reset the dev database

```bash
rm node_modules/.alepha/sqlite.db
yarn dev   # recreates + runs migrations from migrations/sqlite/
```

Clears all projects, members, sessions, etc. Migrations auto-apply on boot. Optionally also `rm -rf node_modules/.alepha/emails/` to clear the inbox.

### Playwright tips

- Hostname is `localhost`, no HTTPS in dev/prod-like.
- The session cookie persists across reloads; if you need a clean slate, clear cookies via `context.clearCookies()` rather than relaunching the browser.
- Pages load lazily — wait for the visible text of a known route element (e.g. "Projects") before asserting.
- `claude-in-chrome` MCP works fine; the deferred `playwright` MCP is what most of the existing e2e specs target.

## Working on the framework while in this repo

Lore is a workspace member of the Alepha monorepo — there is no vendor step. Edit `../../packages/alepha/src/...` or `../../packages/@alepha/ui/src/...` directly; Vite HMR picks the change up immediately. Run `yarn v --fast` from the monorepo root to verify framework + apps together before committing.

The same CI run that ships Alepha now also verifies Lore (because Lore is just another workspace under `yarn workspaces foreach`), and the `deploy-lore-production` job in `.github/workflows/ci.yml` ships Lore to Cloudflare on every push to `main`. So a single commit covers both sides — no cross-repo handoff, no sync drift to worry about.
