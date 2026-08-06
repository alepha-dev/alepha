# Alepha Lore

Project management app built with [Alepha](https://github.com/feunard/alepha). Users create **projects**, forge **quests** with objectives, invite **members**, and progress together across **zones**. The RPG vocabulary describes the work, never the person — there is no XP, gold, level or achievement system (see "De-gamification" below).

It has since grown well past a quest tracker. The load-bearing surfaces today are **quests** (roadmap + in-flight work), **folios** (project memory, wiki-linked, optionally end-to-end encrypted, and — since the 2026-08 rename — including the directory tree + binary blobs that used to be a separate "Archive" module), **feedback** (inbound bug/feature triage), and **blights** (deduplicated crash telemetry from partner sites via **sigils**). All four are exposed over **MCP**, which is the primary consumer.

Alepha Lore is the **only public Alepha app** and exists in large part to **dogfood the framework** — improvements and bug fixes upstream are part of the job, not a side quest.

## The Lore of Lore (start here)

The production Alepha Lore instance hosts the project we actually use to run this project: **`https://lore.alepha.dev/p/2`** — the "Lore of Lore." It is the canonical source of truth for what's planned, in-flight, and remembered on Alepha Lore itself. It also dogfoods the MCP surface — every Claude session working on this repo should treat that project as a first-class input, not background trivia.

**Before non-trivial work, orient via MCP** (these tools are already exposed on `mcp__claude_ai_Lore__*` for this account, project id `2`):

1. `project_context` — one-shot orientation (project metadata + active quests + folio index, ~2K tokens).
2. `folio_get` on the folios that look relevant — folios are the shared memory between you and the user across sessions. The user relies on them heavily, so **read first, write often**.
3. `quest_list` / `quest_get` — quests are the **most load-bearing** piece. They are the roadmap and the in-flight work tracker. If a task corresponds to a quest, drive it from the quest (read objectives, update status, complete on done).

**Write back what's worth keeping.** When a session produces a non-obvious decision, gotcha, or architectural fact about Lore/Alepha, persist it as a folio (`folio_create` / `folio_update` with good `tags` + `summary`). When in-flight work changes scope or completes, reflect it on the matching quest. Conversation history is ephemeral; folios and quests are the project's long-term memory.

Lore's vocabulary has been renamed twice. Originally the codebase used the plain technical names `project`/`task`/`package`/`players`/`analytics`/`complexity`; a first rename swapped every one of those for RPG flavor — `campaign`/`quest`/`zone`/`member`/`chronicles`/`difficulty` — across code identifiers, DB tables, HTTP routes, MCP tools and URL params. The **2026-08 great rename** partially reversed that: the top-level container went back to the plain, technical **`project`** (campaign → project, `/c/:campaignId` → `/p/:projectId`, `campaign_*` MCP tools → `project_*`), because "campaign" read as more RPG-themed than the container itself deserved. The RPG vocabulary that describes the *work inside* a project was kept and in some cases sharpened: **quest**, **zone**, member, folio, blight, sigil, and the F/C/B/A/S difficulty ranks are all still RPG-flavored on purpose. Three other nouns were renamed in the same pass for clarity rather than theme: Petitions → **Feedback**, Chapters → **Milestones**, and Chronicles → **Reports** (with Reports▸Party → Reports▸Members). The old standalone "Archive" module (directory tree + blobs) was folded entirely into **Folios** — same entities, same MCP tools, one mental model instead of two. A **user** is the account; a **member** is that user's membership row in a project. Identity (name, picture) always comes from the account — the per-project "character" concept was removed in the 2026-07 de-gamification pass.

All user-facing strings still go through `I18n.ts` for EN/FR localization.

## Repository layout

Lore lives inside the **Alepha monorepo** at `apps/lore`. The Alepha framework is a sibling workspace at `../../packages/alepha`; the shared shadcn UI lives at `../../packages/@alepha/ui`. Yarn workspace links route imports of `alepha` / `@alepha/ui` to those local packages — no vendoring, no sync step.

**Why this matters for AI:** Alepha is a small framework that LLMs have **near-zero training data on**. Do not guess Alepha APIs from memory — they will be wrong. Read `../../packages/alepha/src/...` and `../../packages/@alepha/ui/src/...` as the authoritative source whenever framework behavior matters. Editing them from inside `apps/lore` is fine — they're the same monorepo. Run `yarn v` from the monorepo root to verify framework + lore together.

```
apps/lore/                # This app
├── src/                  # App source
│   ├── api/              # Backend
│   │   ├── controllers/  # 20 controllers — see list below
│   │   ├── entities/     # 23 entities — see list below
│   │   ├── providers/    # AppSecurityProvider (membership/owner gates), LoreFileAccessProvider (per-file IDOR gate), LoreSigilSinkProvider (in-process self-report — a Worker can't fetch its own hostname)
│   │   ├── jobs/         # BlightJobs (retention purge), InvitationJobs, MilestoneJobs, QuestJobs (reminder sweep)
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

**Controllers (20)** — `AdminInvitation`, `Blight`, `Blob`, `Directory`, `Feedback`, `Folio`, `Identity`, `Insights`, `Invitation`, `Kanban`, `Milestone`, `Project`, `ProjectQuestPortability`, `ProjectReports`, `Quest`, `Session`, `Sigil`, `SigilIngest`, `User`, `Version`.

**Entities (23)** — `blightIgnoreRules`, `blights`, `feedback`, `files`, `folioBlobs`, `folioDirectories`, `folioLinks`, `folioNames`, `folioRevisions`, `folios`, `identities`, `invitations`, `members`, `milestones`, `projects`, `quests`, `sessions`, `sigilErrorGroups`, `sigilUniquesDaily`, `sigilViewsHourly`, `sigilVitalsHourly`, `sigils`, `users`.

**Services (18)** — `BlightRuleService`, `FeedbackRateLimiter`, `FolioBlobService`, `FolioDirectoryService`, `FolioHistoryService`, `FolioLinkService`, `FolioNameService`, `InvitationService`, `PinnedFolioFolder`, `ProjectLimits`, `ProjectSecurityService`, `QuestCsvFormatter`, `QuestCsvParser`, `QuestImportFormatProvider`, `QuestResourceMapper`, `QuestService`, `SigilIngestService`, `SigilTokenService`, plus `parsers/`.

**MCP tools (8)** — `BlightTools`, `FeedbackTools`, `FolioTools` (absorbed the old `ArchiveTools`: `directory_*` / `blob_*` live here now), `InsightsTools`, `MilestoneTools`, `ProjectTools`, `QuestTools`, `SigilTools`.

## Routes

Defined in `src/web/app/AppRouter.ts`. Route names (the `$page` keys) are what `router.path(...)` / `router.push(...)` consume.

| Path | Route name | Page (lazy) | Notes |
|------|------------|-------------|-------|
| `/` | `home` | `home/Home.tsx` | Project list |
| `/new-project` | `projectCreate` | `project/ProjectCreate.tsx` | New project form |
| `/p/:projectId` | `project` | `project/ProjectView.tsx` | Project layout — sets `currentProjectAtom` + milestones/member/quests/feedback-count/blight-count/quest-count on load |
| `/p/:projectId/` | `projectQuests` | `project/ProjectQuestsPage.tsx` | Quest list grouped by zone; renders the kanban board instead when the URL has `?view=kanban` (see "Kanban ↔ Header Communication" below — kanban is no longer its own route) |
| `/p/:projectId/milestones` | `projectMilestones` | `project/milestones/ProjectMilestones.tsx` | Milestones list |
| `/p/:projectId/reports` | `projectReports` | `project/reports/ReportsLayout.tsx` | Reports layout |
| `/p/:projectId/reports/` | `reportsOverview` | `project/reports/ReportsOverview.tsx` | Overview |
| `/p/:projectId/reports/quests` | `reportsQuests` | `project/reports/ReportsQuests.tsx` | Quest analytics |
| `/p/:projectId/reports/members` | `reportsMembers` | `project/reports/ReportsMembers.tsx` | Per-member contribution (was Reports▸Party) |
| `/p/:projectId/feedback` | `projectFeedback` | `project/feedback/ProjectFeedback.tsx` | Owner inbox: triage bug/feature requests |
| `/p/:projectId/blights` | `projectBlights` | `project/blights/ProjectBlights.tsx` | Crash-telemetry inbox (sigil-fed) |
| `/p/:projectId/apps/:sigilId` | `projectApp` | `project/apps/AppLayout.tsx` | One enrolled app: tab bar + the range toggle every tab shares. Param is `:sigilId`, **never** `:id` — see the router note below |
| `/p/:projectId/apps/:sigilId/` | `app` | `project/apps/AppDashboard.tsx` | Headline numbers + the credential card |
| `/p/:projectId/apps/:sigilId/analytics` | `appAnalytics` | `project/apps/AppAnalytics.tsx` | Page views, unique visitors, top pages/countries. 404 when `features.beacon` is off |
| `/p/:projectId/apps/:sigilId/performance` | `appPerformance` | `project/apps/AppPerformance.tsx` | Web-vitals p75. 404 when `features.beacon` is off |
| `/p/:projectId/apps/:sigilId/errors` | `appErrors` | `project/apps/AppErrors.tsx` | This app's error budget. 404 when `features.beacon` is off |
| `/p/:projectId/apps/:sigilId/settings` | `appSettings` | `project/apps/AppSettings.tsx` | Rotate / delete this app (owner-only server-side) |
| `/p/:projectId/q/:shortId` | `projectQuest` | `project/quest/QuestView.tsx` | Quest detail (param is the integer `shortId`, not a UUID) |
| `/p/:projectId/q/:shortId/graph` | `projectQuestGraph` | `project/quest/QuestGraph.tsx` | Quest dependency graph |
| `/p/:projectId/folios` | `projectFolios` | `folios/FoliosLayout.tsx` | Folio + directory-tree index |
| `/p/:projectId/folios/new` | `projectFoliosNew` | `folios/FolioCreatePage.tsx` | New folio |
| `/p/:projectId/folios/:shortId` | `projectFoliosFolio` | `folios/FolioView.tsx` | Folio detail |
| `/p/:projectId/folios/:shortId/edit` | `projectFoliosFolioEdit` | `folios/FolioEditPage.tsx` | Folio editor |
| `/p/:projectId/settings` | `projectSettings` | `project/settings/ProjectSettings.tsx` | Settings layout (sub-routes below) |
| `/p/:projectId/settings/` | `projectSettingsBanner` | `…/ProjectSettingsGeneralPage.tsx` | General / banner |
| `/p/:projectId/settings/members` | `projectSettingsMembers` | `…/ProjectSettingsMembersPage.tsx` | Members & pending invitations — the future home of per-member access rights |
| `/p/:projectId/settings/zones` | `projectSettingsZones` | `…/ProjectSettingsZonesPage.tsx` | Zones config |
| `/p/:projectId/settings/kanban` | `projectSettingsKanban` | `…/ProjectSettingsKanbanPage.tsx` | Kanban columns config |
| `/p/:projectId/settings/folios` | `projectSettingsFolios` | `…/ProjectSettingsFoliosPage.tsx` | Folios config |
| `/p/:projectId/settings/sigils` | `projectSettingsSigils` | `…/ProjectSettingsSigilsPage.tsx` | Sigil inventory + module toggles |
| `/p/:projectId/settings/milestones` | `projectSettingsMilestones` | `…/ProjectSettingsMilestonesPage.tsx` | Milestone config |
| `/p/:projectId/settings/quests` | `projectSettingsQuests` | `…/ProjectSettingsQuestsPage.tsx` | Per-quest module toggles (note / chrono / reminder) |
| `/p/:projectId/request` | `projectFeedbackRequest` | `project/feedback/ProjectFeedbackRequest.tsx` | First-party feedback form (login required). Top-level, **not** nested under the `project` layout — no membership check |
| `/auth/profile/feedback` | `myFeedback` | `profile/feedback/MyFeedback.tsx` | A reporter's own submissions across all projects, declared in `src/web/app/components/profile/me/MeRouter.ts` (nested under `me` at `/auth/profile`), not in `AppRouter`. Detail is a drawer/sheet (`MyFeedbackEditSheet.tsx`), not a separate route — there is no per-feedback status page anymore |
| `/*` | `notFound` | `NotFound` | — |

Also top-level under the shared layout: `/auth/login` (`login`), `/oauth/continue` (`oauthContinue`), `/auth/register` (`register`), `/auth/reset-password` (`resetPassword`).

HTTP API routes follow the same vocabulary: `/projects/:id/quests/export`, `/quests/attachments`, `/kanban/:projectId`, `/projects/:projectId/feedback`. MCP tools are `project_*`, `quest_*`, `milestone_*`, `folio_*` (also `directory_*` / `blob_*`), `feedback_*`, `blight_*`, `sigil_*`, `insights_*`.

### ⚠️ Deleting or renaming a `$page` is not typecheck-protected

`router.path("someRouteName", ...)` / `router.push("someRouteName", ...)` are typed against the live route table — but only while the name exists. The moment a route is renamed or removed, any call site still passing the old name silently widens to the plain `string` overload instead of erroring. The build stays green; the call throws at render time, in production, the first time a user hits that code path. This bit the 2026-08 rename directly (`campaignQuest` → `projectQuest` etc., and the whole `Kanban` board route disappearing in favour of `?view=kanban`). **Deleting or renaming a route name requires grepping the whole `src/` tree for the old string**, including nav arrays like `ProjectSettings.tsx`'s sidebar list and `ProjectView.tsx`'s `ROUTES_APP` set, which reference route names as plain strings with nothing in the type system tying them to the routes they name (see the comment on `projectSettingsSigils` in `AppRouter.ts`).

`test/app-routes.spec.ts` is the partial automated guard added with the Apps page: it boots the real router and resolves every name the nav navigates to by string, so a deleted route is a red test rather than a production throw. It only covers the names listed in it — adding a route name to a nav means adding it there too.

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
- `currentSigilsAtom` — the enrolled apps the sidebar's Apps section lists. Fetched behind `.catch(() => [])`: reads are member-gated but a transient failure must cost the section, not the page

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
Kanban is not a route anymore — it's a `?view=kanban` query toggle on the `projectQuests` page (`ProjectQuestsPage.tsx` reads `routerState.query.view === "kanban"` and renders `KanbanBoard` instead of `ProjectQuestsTable`; the view lives in the URL rather than component state so a shared link still opens a board and the back button behaves). `KanbanBoard` sets `kanbanProjectAtom` with `{ project }`. The Header reads it to:
1. Show the project name in the header (falls back from `currentProjectAtom`)
2. Show the Board/Kanban toggle link (a plain `?view=kanban` query param, not a navigation to a different route)
3. Show the "Create Quest" button

After creating a quest from the header, it bumps `kanbanReloadAtom` which `KanbanBoard` watches to trigger a reload.

### QuestView Reusability
`QuestView` works in two contexts:
1. **Project page** — rendered as a route (`/p/:id/q/:shortId`), reads from `currentProjectAtom`, navigates via router
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
- `/p/:projectId/request` — first-party form on lore (`ProjectFeedbackRequest.tsx`, route `projectFeedbackRequest`). Anonymous visitors see a sign-in CTA. Once logged in, they get the full form (title, description, type bug/feature, file uploads).
- External "report a bug" buttons on third-party sites are plain `<a target="_blank" rel="noopener noreferrer">` anchors pointing to `/p/:id/request?path=<encoded>&url=<encoded>&type=bug` — no embedded JS, no screenshot capture, no widget. The page reads query params, persists them to `sessionStorage` (key `lor.feedback.draft.<projectId>` — renamed from `lor.petition.draft` in the same pass, unlike the storage bucket literals below, because this key is not a persisted external reference, just a transient client-side draft), cleans the URL via `history.replaceState`, and re-reads after the OAuth round-trip. Cleared on successful submit. `@alepha/sigil`'s reporting client also surfaces this same request URL as `feedbackUrl` in its `/sigils/config` response (only when `features.feedback` is on) so an enrolled app's own "report a bug" widget links out to it.

**Reporter-facing views** — `/auth/profile/feedback` (`myFeedback`, own submissions across projects, detail in a drawer/sheet). There is no separate per-feedback status page (the old one was retired before this rename).

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
- Routes: `projectFeedback` (under `project`), `projectFeedbackRequest` (top-level, not under the project layout — public landing), `myFeedback` (under `me`)

## Folios are this project's memory for Claude

Folios are markdown notes scoped to a **project** and shared across all its members (they were per-user before quest #65) — they mirror the `~/.claude/projects/*/memory/MEMORY.md` pattern but at the project level: persistent across sessions, exportable, tagged, fully MCP-readable. Treat them as the canonical place where any agent working on a Lore project should look for context and write down what it learns.

Since the 2026-08 great rename, Folios also absorbed the standalone **Archive** module — the directory tree + binary blobs that used to have their own URL path, entities (`archiveDirectories`/`archiveBlobs`/`archiveNames`) and MCP tool class (`ArchiveTools`). Folios live in a directory tree rather than nesting under each other. `folioDirectories` is the tree (depth-capped at 8), `folioBlobs` holds binary attachments, and `folioNames` backs name-uniqueness. `folios.directoryId` is `undefined` for the project root and **cascades on directory delete** — removing a directory removes everything in it, folios included. Surfaced at `/p/:id/folios` and over MCP via `FolioTools` (`directory_*`, `blob_*` tools live in this same file now).

**Conventions** (apply when curating folios — yourself or via Claude):

- One topic per folio. Use the title as the topic; use tags (`tech/decision`, `runbook`, `incident`, …) for taxonomy.
- Keep folios short and self-contained. A folio that needs scrolling is two folios.
- When an agent creates a folio via MCP, it should always provide useful `tags` AND a `summary` (1-2 sentences, ~200 chars) so future `folio_list` / `folio_search` calls stay precise and `project_context` returns a self-explanatory index. Web-created folios may leave `summary` empty — the index falls back to the title.
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
- Controller: `src/api/controllers/FolioController.ts` (list, listTags, getByShortId, get, getLinks, create, update, delete, listProjectActivity, listHistory, revertHistory, pinHistory)
- Directory / blob controllers: `src/api/controllers/DirectoryController.ts`, `src/api/controllers/BlobController.ts`
- History: `src/api/services/FolioHistoryService.ts` (append, retention sweep, protection-domain purge)
- MCP tools: `src/mcp/tools/FolioTools.ts` (folio, directory and blob tools) + `ProjectTools.ts` (`project_context`)
- UI: `src/web/app/components/folios/FolioEditor.tsx`, `FolioView.tsx`, `FolioBacklinksPanel.tsx`, `FolioBrowser.tsx`, `FolioTreePanel.tsx`

**Bucket literals kept un-renamed** — `FOLIO_BLOB_BUCKET = "archive-blobs"` (`FolioBlobService.ts`, `LoreFileAccessProvider.ts`, `BlobController.ts`, `FolioBrowser.tsx`, `useFolioImageUpload.ts`). Same reasoning as the `petition-attachments` bucket in the Feedback section: it's a value already persisted on every existing `files` row, and renaming it would orphan every folio image/blob ever uploaded.

### ⚠️ Protected folios: the protection-domain invariant

A folio with `protected: true` stores a client-side `BrowserCryptoProvider` envelope in `content`. The server never sees the passphrase or the plaintext.

**Invariant: `folio_revisions` never holds a snapshot from a different protection domain than the folio's current one.** Crossing the boundary in either direction purges the folio's revision history (`FolioHistoryService.purgeRevisions`, called from `FolioController.update` when `isProtected !== existing.protected`).

This is a **confidentiality requirement**, not a tidiness one. Before it existed, encrypting a folio blanked `searchText` and wiped the outbound links but left every pre-encryption plaintext snapshot in `folio_revisions` — readable by any project member through `GET /folios/:id/history`. Encrypting protected nothing already written. It also meant `revertHistory` could write a plaintext snapshot into a folio still flagged `protected`, leaving it undecryptable in the UI.

`pinned` revisions are exempt from the retention sweep but **not** from this purge. Regression guard: `test/folio-protected-history.spec.ts`.

## Sigils, Blights, Beacon, Vitals

A **sigil** is one **app** that reports into a project: a free-form `name`, unique on `(projectId, name)`, and nothing else. It authenticates with a `sg_`-prefixed bearer token, stored hashed and shown once at creation; `tokenPrefix` exists so the UI can name a credential it cannot reconstruct.

> Until 2026-08-06 a sigil was "one environment of one application" — `app` + `environment` + a display `label`, unique on `(projectId, app, environment)`. The three columns collapsed into one `name` (migration `20260806093400_confused_dazzler`, hand-written and additive; see "Migration safety on D1" below). How finely to slice is now the operator's decision rather than the schema's: an app that wants staging kept apart from production enrols two sigils and names them so. Older notes and folios still use the old vocabulary.

Enrolled at `/p/:id/settings/sigils` and administered per-app at `/p/:id/apps/:sigilId` (`SigilController`, reads member-gated, mutations owner-gated — no role, no allowlist: owning the project is the whole gate). `features.sigils` is the master switch, with `feedback` / `blights` / `beacon` / `vitals` as the per-capability toggles `GET /sigils/config` reports back to the app.

**Apps are a sidebar section, not a settings page.** Since 2026-08-06 the project sidebar carries a collapsible **Apps** group (gated on `features.sigils`) listing every enrolled app by name; each opens that app's own page. Rotate and delete live on that page's Settings tab — the settings page enrols and lists, and its rows link out. An empty project shows the group with a single "Enrol an app" entry rather than hiding the section. The list reaches the sidebar through `currentSigilsAtom`, filled by the `project` route loader (defensively: `listSigils` is member-readable, but a failure costs the section, not the page).

**The toggles are enforced, not advertised.** `SigilIngestService.gatesFor` intersects the project's features with the sigil's `kinds`, and both `absorb` (the write gate) and `/sigils/config` (the advertisement) call it — one definition, so the sink cannot invite a payload it then discards. Enforcing on write is not redundant with the config poll: `sigils.kinds` is written once at creation and has **no update path anywhere**, and the reporting client fails open on any config error, so gating on the token alone left an owner's "off" switch as a suggestion.

**Rotate, don't delete.** All four aggregate tables cascade on `sigilId`, so deleting a sigil to revoke a leaked token also erases that app's views, vitals, uniques and error groups. `rotateSigil` re-mints `tokenHash`/`tokenPrefix` in place — the old token stops resolving immediately (`verify` looks a sigil up *by* its hash) and every row survives. The UI says which is which; so do the MCP tool descriptions.

- **Blights** — one row per distinct failure, keyed by `(projectId, fingerprint)`, with a count. The owner triages them in the inbox (`/p/:id/blights`): resolve, ignore-by-rule (`blightIgnoreRules`), or **forward to a quest** (filed under the `Blights` zone, provenance recorded in `quests.source`). Purged on a retention window (`project.retentionDays ?? 30`) by `BlightJobs`; resolved and `quest:`-forwarded rows are kept as audit trail. A blight survives its sigil — `blights.sigilId` is `ON DELETE SET NULL`.
- **Insights** (`InsightsController`, gated on `features.beacon`) — three segments over one payload: **Analytics** (page views, unique visitors), **Performance** (web-vitals p75) and **Errors** (the per-app error budget), read out of `sigil_views_hourly` / `sigil_uniques_daily` / `sigil_vitals_hourly` / `sigil_error_groups`. Buckets are hourly so a 14:00 deploy is visible against 13:00; the daily timeline is a `substr(hour, 1, 10)` group over the same rows. `uniqueVisitors` is the trustworthy headline — nothing throttles what an app reports, so `totalViews` is inflatable by whoever holds the token. The three segments are now the Analytics / Performance / Errors **tabs of one app's page**; `GET /projects/:projectId/insights?sigilId=` is what narrows them, and the id is verified to belong to the project in the path before it filters anything (member-gating is on the project, so an unchecked id would read another project's rows). Omitted, the endpoint still answers project-wide — which is what MCP's `insights_read` reads.
  - The **Errors** segment is the only place `sigil_error_groups` is read. It answers "is this still happening *in that app*", which the Blights inbox cannot: the inbox keys on `(projectId, fingerprint)` so a triage decision does not fork, which necessarily merges every enrolled app into one row. Filtered on `lastSeenAt` (still failing), ordered by `count`, capped at 20.

> ⚠️ **`name`, `message`, `stack`, `sourceUrl` on a blight are 100% attacker-controlled** and are shown to the project owner — the highest-value target. Render as escaped plain text only. Never markdown, never `dangerouslySetInnerHTML`.

Read endpoints are member-gated; mutations are owner-only. **Ingest has its own credential**: `POST /sigils/ingest` and `GET /sigils/config` (`SigilIngestController`, `$route` so they sit at the root) accept a sigil bearer token and nothing else — a logged-in member cannot post telemetry, and a sigil token opens nothing but those two routes.

**The reporting half is a package, not an app.** `packages/@alepha/sigil` is what an enrolled app imports; it reads `SIGIL_SINK` + `SIGIL_KEY` (the token minted above) from env, aggregates errors by fingerprint before they leave the process, and polls `/sigils/config` for a kill-switch it obeys immediately. The two wire paths are one definition (`@alepha/sigil/paths`) imported by both ends — the client fails open, so a path disagreement is silent in both directions and has drifted once already. Lore itself sets neither variable: it is the sink, and a Cloudflare Worker cannot fetch its own hostname — `LoreSigilSinkProvider` substitutes the base `SigilSinkProvider` in `main.server.ts` to route Lore's own self-report in-process instead.

**Where to look**

- Entities: `src/api/entities/sigils.ts` (the credential + `(projectId, name)` unique index), `blights.ts`, `sigilErrorGroups.ts`, `sigilViewsHourly.ts`, `sigilUniquesDaily.ts`, `sigilVitalsHourly.ts`
- Owner CRUD: `src/api/controllers/SigilController.ts` (create / list / rotate / delete)
- Ingest: `src/api/controllers/SigilIngestController.ts` + `src/api/services/SigilIngestService.ts`
- Credential: `src/api/services/SigilTokenService.ts` (mint / verify / bearer)
- Triage: `src/api/controllers/BlightController.ts`, `src/api/services/BlightRuleService.ts`, `src/api/jobs/BlightJobs.ts`
- Analytics: `src/api/controllers/InsightsController.ts` (schemas extracted to `src/api/schemas/insightsResourceSchema.ts` / `sigilResourceSchema.ts` so the browser can validate the atoms without importing a controller)
- UI — enrolment: `src/web/app/components/project/settings/ProjectSettingsSigilsPage.tsx` (+ `…SigilRow`), `shared/TokenReveal.tsx`
- UI — per app: `src/web/app/components/project/apps/AppLayout.tsx` (+ `AppDashboard`, `AppAnalytics`, `AppPerformance`, `AppErrors`, `AppSettings`); sidebar section in `project/ProjectView.tsx`; atoms `currentSigilsAtom` / `currentSigilAtom` / `currentSigilInsightsAtom`
- UI — triage: `project/blights/ProjectBlights.tsx`
- MCP: `src/mcp/tools/SigilTools.ts`, `src/mcp/tools/BlightTools.ts`
- E2E: `e2e/sigil.spec.ts` — enrol → ingest → triage → open the app from the sidebar → tabs → rotate → delete, with ingest driven through Playwright's isolated `request` fixture (the page's `fetch` is patched to attach the session bearer, which would replace the sigil token)

## I18n

Two languages: English (`en`) and French (`fr`). All translations in `src/web/app/services/I18n.ts`. Always use `tr()` from `useI18n<I18n, "en">()` — never hardcode strings.

## De-gamification (2026-07)

Lore has **no gamification currency**: no XP, no gold, no levels, no achievements, no titles, no per-project alias/avatar. All of it was removed in two passes:

- First pass killed the wall: `FeaturePaywallService` / Shop / `requiredLevel` quest gating. Ex-walled features (Reports, Quest Reminder, …) are plain `project.features.*` owner toggles.
- Second pass removed the remaining cosmetic progression and collapsed `characters` into `members` (migration `20260730154120_heavy_nova`: `ALTER TABLE characters RENAME TO members` + column drops — no rebuild, D1-safe). `CharacterInfo`, `AchievementEngine`, `CharacterController`, the character sheet, roster, XP bar and level-up animation are gone.

What survives, deliberately:

- **Quest rank letters F/C/B/A/S** — derived from quest difficulty 1–5 in `src/web/app/components/project/quest/questRank.ts`. A property of the task, never of the person.
- The RPG **vocabulary** for the work inside a project (quests, zones, folios, blights, sigils) — flavor, not mechanics. The container itself is deliberately *not* RPG-flavored — see "The Lore of Lore" above for why it's `project`, not `campaign`.
- `projects.unlockedFeatures` / `unlockHistory` / `public` — **`@deprecated` dead columns**. Nothing reads or writes them; they stay because dropping a `projects` column risks the D1 rebuild path and `projects` is the CASCADE parent that wiped prod in 2026-05.

Do not reintroduce progression mechanics without an explicit decision — the goal is a neutral tool usable with other people; the metaphor describes the work, never the person.

## Key Dependencies

- `@dnd-kit/core` — drag & drop (kanban, quest board)
- `@mdxeditor/editor` — the shared WYSIWYG markdown editor (`src/web/app/components/shared/markdown-editor/MarkdownEditor.tsx`): lazy client-only, markdown-features-only, source-mode toggle, per-context image upload (folios → folio blobs; quests → attachments, embedded ids merged server-side by `QuestService.mergeEmbeddedAttachments`). Rendering stays `@alepha/ui` `MarkdownView`. The feedback request form keeps a plain textarea (its own paste/drag attachment flow)
- `recharts` — reports charts
- `tw-animate-css` — generic enter/exit keyframe utilities used from Tailwind classes (replaces the old `animate.css`)

## Commands

```bash
yarn dev               # Dev server (HMR) on http://localhost:5173
yarn start             # Prod-like (build + node dist) on http://localhost:3000
yarn build             # Production build
yarn typecheck         # tsc --noEmit
yarn lint              # biome check --fix
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

- **Avoid the rebuild entirely.** If the only change is a column *default* (the bomb we hit), move the default into the application handler — e.g. `createProject` injects `defaultProjectFeatures` server-side — and drop the `db.default(...)` from the entity schema. Drizzle won't generate a rebuild migration for an app-layer default.
- **Manually rewrite the migration** to back child rows up into `__bk_*` tables before the `DROP`, then re-insert and drop the backups after `RENAME`. Tedious but correct.
- **Temporarily switch the CASCADE child(ren) to `onDelete: "set null"`** for the migration window if the children make sense without a parent — only viable when the FK column is nullable.

**Why local testing won't catch this:** `yarn v` uses in-memory SQLite, where `PRAGMA foreign_keys=OFF` actually works. The bomb only goes off on D1. Inspect the migration SQL manually.

**CI auto-deploys to prod on every push to `main`** (alepha monorepo's `.github/workflows/ci.yml` → `deploy-lore-production` job → `yarn alepha platform up --env production` from `apps/lore`). There is no human gate between push and prod migration. Treat every D1 migration as you would a `DROP DATABASE` — read every line before pushing.

### What the 2026-08 great-rename migration got right (worked example)

`migrations/sqlite/20260805005114_green_captain_universe/` is a rename-only migration for the whole vocabulary rename — **6 table renames** (`campaigns`→`projects`, `petitions`→`feedback`, `chapters`→`milestones`, `archive_directories`→`folio_directories`, `archive_blobs`→`folio_blobs`, `archive_names`→`folio_names`) and 15 column renames, entirely via `ALTER TABLE ... RENAME TO` / `RENAME COLUMN`. **Zero `DROP TABLE`.**

drizzle-kit's auto-generator wanted to add a `projects` table *rebuild* on top of the renames, because the `features` column's JSON `DEFAULT` embeds the old key names (`petitions`, `chapters`, …) baked in as a literal string, and those keys changed too. A rebuild there means `DROP TABLE projects`, which on D1 cascades through `members`/`quests`/`milestones`/`folios`/`feedback` — the exact class of incident described above. That block was **deleted by hand** from the generated migration, replaced with an explanatory SQL comment. This is safe *only* because nothing reads the stale column default — `createProject` injects `defaultProjectFeatures` server-side in application code, so the column's `DEFAULT` clause is dead weight. The upshot: **the migration snapshot and the live `projects.features` column now deliberately disagree on that one default, forever** (or until a future migration touches that column for an unrelated reason). Do not "fix" this drift by generating a rebuild — that's the bomb, not the fix. `db:generate`/`db:check` will keep flagging it; that's expected, not a regression.

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
*table and columns*, but the JSON **inside** the column still said `petitions`
and `chapters` on all 54 existing rows. A missing required key does not read as
`undefined` and fall back to `false` — **the whole row fails to decode**, so
every query touching `projects` throws.

The plan had predicted "the flags read as undefined → off, owners re-enable them
once." That reasoning came from the *optional* flags and was never checked
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
returns integer `1`, so a naive round-trip writes `1` and the row *still* fails
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

**SQLite refuses this on any table that has rows** — *"Cannot add a NOT NULL column
with default value NULL"* — and accepts it on an empty one. Every database CI, `yarn v`
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
`UNIQUE` index. Read generated migrations for what they *omit*, not only for `DROP TABLE`.

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

Lore is a telemetry sink again, and `/sigils/ingest` + `/sigils/config`
(`SigilIngestController`, `$route` so they sit at the root rather than under
`/api`) are publicly reachable by construction: apps report to them from every
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

55 unit / integration specs in `test/` (Vitest, in-memory SQLite). Notable ones:

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
- `insights-controller.spec.ts` / `insights-tools.spec.ts` — beacon/vitals windows and the p75 walk (clock pinned with `DateTimeProvider.pause()`), the `?sigilId=` per-app filter including the cross-project refusal, plus the MCP surface
- `app-routes.spec.ts` — **regression guard**: boots the real `AppRouter` and resolves every route name the sidebar and settings nav navigate to by string. `router.path()` takes `keyof VirtualRouter<T> | string`, so a deleted or renamed route is never a type error — this is the only thing that turns it into a red test instead of a production throw
- `blight-tools.spec.ts` — the MCP triage surface
- `migration-safety.spec.ts` — asserts the great-rename migration (and the sigil-family rebuild before it) never drops a table the `projects` cascade reaches, and that a fresh D1-shaped database boots with all migrations applied
- `petition-reporter-migration.spec.ts` / `petition-reporter-restore-migration.spec.ts` — deliberately still "petition"-named: they pin the behavior of two specific *historical* migrations (`reporterUserId`/`reporterEmail` column churn) that predate the 2026-08 rename, not the current Feedback module
- Shared fixtures live in `test/fixtures/`

### E2E convention: one file per feature

`e2e/` is split by feature, not by user journey. One `<feature>.spec.ts` per major surface, each covering happy path + key edge cases:

- `sigil.spec.ts` — enrol an app → ingest as it → triage in the inbox → open the app from the sidebar's Apps section → walk its tabs → rotate → delete
- `blights.spec.ts` — regression guard for the inbox render loop (the ingest path lives in `sigil.spec.ts`)
- `quest.spec.ts` — quest lifecycle (open → accept → complete) + reminder UI
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
- `home.spec.ts`, `admin-user-detail.spec.ts`
- `security-public-project.spec.ts` — regression guard: non-member account hits 403 on every project endpoint after the public-project purge (renamed from `security-public-campaign.spec.ts`)
- `security-file-access.spec.ts` — regression guard: `/api/files/:id` IDOR fix via `LoreFileAccessProvider` (only owners/members can download an attachment)

Shared setup (register/verify, project-create wizard, API helpers) lives in `e2e/_helpers.ts`. Re-use those rather than copy-pasting auth setup into each new spec.

`setProjectFeature(page, projectId, key, value?)` flips a project feature toggle from inside a flow — use it when a spec needs an off-by-default module (e.g. `questReminder`). It replaced the old `unlockShopFeature`, which farmed gold from a throwaway quest to fund a Shop purchase; the Shop no longer exists.

**When adding or modifying a feature, the matching `<feature>.spec.ts` must move with it.** No feature ships without its e2e moving in lockstep. If no spec exists yet for the feature, create one — start by composing `registerAndVerify` + `createProjectViaWizard` from `_helpers.ts`, then drive the feature-specific UI.

## Manual testing via Playwright (Claude)

When you need to drive the app yourself with the Playwright MCP, use these shortcuts.

### Servers

| Mode | Command | URL | Database |
|---|---|---|---|
| **Dev** (HMR, no build) | `yarn dev` | http://localhost:5173 | `node_modules/.alepha/sqlite.db` (persistent) |
| **Prod-like** (build + run) | `yarn start` | http://localhost:3000 | in-memory (`DATABASE_URL=:memory:`) — wiped on restart |

Dev mode is what you usually want — it keeps state between runs and emails accumulate on disk.

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

Lore is a workspace member of the Alepha monorepo — there is no vendor step. Edit `../../packages/alepha/src/...` or `../../packages/@alepha/ui/src/...` directly; Vite HMR picks the change up immediately. Run `yarn v` from the monorepo root to verify framework + apps together before committing.

The same CI run that ships Alepha now also verifies Lore (because Lore is just another workspace under `yarn workspaces foreach`), and the `deploy-lore-production` job in `.github/workflows/ci.yml` ships Lore to Cloudflare on every push to `main`. So a single commit covers both sides — no cross-repo handoff, no sync drift to worry about.
