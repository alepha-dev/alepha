# Alepha Lore

Campaign management app built with [Alepha](https://github.com/feunard/alepha). Users create **campaigns**, forge **quests** with objectives, invite **members**, and progress together across **zones**. The RPG vocabulary describes the work, never the person — there is no XP, gold, level or achievement system (see "De-gamification" below).

It has since grown well past a quest tracker. The load-bearing surfaces today are **quests** (roadmap + in-flight work), **folios** (campaign memory, wiki-linked, optionally end-to-end encrypted), **petitions** (inbound bug/feature triage), **blights** (deduplicated crash telemetry from partner sites via **sigils**), and the **archive** (directory tree + binary blobs). All five are exposed over **MCP**, which is the primary consumer.

Alepha Lore is the **only public Alepha app** and exists in large part to **dogfood the framework** — improvements and bug fixes upstream are part of the job, not a side quest.

## The Lore of Lore (start here)

The production Alepha Lore instance hosts the campaign we actually use to run this project: **`https://lore.alepha.dev/c/2`** — the "Lore of Lore." It is the canonical source of truth for what's planned, in-flight, and remembered on Alepha Lore itself. It also dogfoods the MCP surface — every Claude session working on this repo should treat that campaign as a first-class input, not background trivia.

**Before non-trivial work, orient via MCP** (these tools are already exposed on `mcp__claude_ai_Lore__*` for this account, campaign id `2`):

1. `campaign_context` — one-shot orientation (campaign metadata + active quests + folio index, ~2K tokens).
2. `folio_get` on the folios that look relevant — folios are the shared memory between you and the user across sessions. The user relies on them heavily, so **read first, write often**.
3. `quest_list` / `quest_get` — quests are the **most load-bearing** piece. They are the roadmap and the in-flight work tracker. If a task corresponds to a quest, drive it from the quest (read objectives, update status, complete on done).

**Write back what's worth keeping.** When a session produces a non-obvious decision, gotcha, or architectural fact about Lore/Alepha, persist it as a folio (`folio_create` / `folio_update` with good `tags` + `summary`). When in-flight work changes scope or completes, reflect it on the matching quest. Conversation history is ephemeral; folios and quests are the project's long-term memory.

The codebase used to use the technical names `project`/`task`/`package`/`players`/`analytics`/`complexity`. As of the great rename, code identifiers, DB tables, HTTP routes, MCP tools, and URL params all match the user-facing vocabulary: `campaign`/`quest`/`zone`/`member`/`chronicles`/`difficulty`. A **user** is the account; a **member** is that user's membership row in a campaign. Identity (name, picture) always comes from the account — the per-campaign "character" concept was removed in the 2026-07 de-gamification pass.

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
│   │   ├── providers/    # AppSecurityProvider (membership/owner gates), LoreFileAccessProvider (per-file IDOR gate)
│   │   ├── jobs/         # BlightJobs (retention purge), ChapterJobs, InvitationJobs, QuestJobs (reminder sweep)
│   │   ├── schemas/      # Request/response schemas
│   │   └── services/     # 18 services — see list below
│   ├── mcp/              # MCP protocol integration (tools, resources)
│   ├── web/
│   │   ├── app/          # Main SPA
│   │   │   ├── atoms/    # 15 state atoms — see "State Atoms" section
│   │   │   ├── components/  # ~119 React components
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

**Controllers (20)** — `AdminInvitation`, `Blight`, `Blob`, `Campaign`, `CampaignQuestPortability`, `CampaignStats`, `Chapter`, `Directory`, `Folio`, `Identity`, `Insights`, `Invitation`, `Kanban`, `Petition`, `Quest`, `Session`, `Sigil`, `SigilIngest`, `User`, `Version`.

**Entities (23)** — `archiveBlobs`, `archiveDirectories`, `archiveNames`, `blightIgnoreRules`, `blights`, `campaigns`, `chapters`, `files`, `folioLinks`, `folioRevisions`, `folios`, `identities`, `invitations`, `members`, `petitions`, `quests`, `sessions`, `sigilErrorGroups`, `sigils`, `sigilUniquesDaily`, `sigilViewsHourly`, `sigilVitalsHourly`, `users`.

**Services (18)** — `ArchiveBlobService`, `ArchiveDirectoryService`, `ArchiveNameService`, `BlightRuleService`, `CampaignLimits`, `CampaignSecurityService`, `FolioHistoryService`, `FolioLinkService`, `InvitationService`, `PetitionRateLimiter`, `PinnedFolioFolder`, `QuestCsvFormatter`, `QuestCsvParser`, `QuestImportFormatProvider`, `QuestResourceMapper`, `QuestService`, `SigilIngestService`, `SigilTokenService`, plus `parsers/`.

**MCP tools (8)** — `ArchiveTools`, `BlightTools`, `CampaignTools`, `ChapterTools`, `FolioTools`, `PetitionTools`, `QuestTools`, `SigilTools`.

## Routes

Defined in `src/web/app/AppRouter.ts`. Route names (the `$page` keys) are what `router.path(...)` / `router.push(...)` consume.

| Path | Route name | Page (lazy) | Notes |
|------|------------|-------------|-------|
| `/` | `home` | `home/Home.tsx` | Campaign list |
| `/new-campaign` | `campaignCreate` | `campaign/CampaignCreate.tsx` | New campaign form |
| `/c/:campaignId` | `campaign` | `campaign/CampaignView.tsx` | Campaign layout — sets `currentCampaignAtom` + chapters/member/quests on load |
| `/c/:campaignId/` | `campaignBoard` | `campaign/CampaignBoardTable.tsx` | Quest list grouped by zone |
| `/c/:campaignId/chapters` | `campaignChapters` | `campaign/chapters/CampaignChapters.tsx` | Chapters list |
| `/c/:campaignId/kanban` | `campaignKanban` | `kanban/KanbanBoard.tsx` | Drag & drop columns |
| `/c/:campaignId/chronicles` | `campaignChronicles` | `campaign/CampaignStats.tsx` | Stats / chronicles layout |
| `/c/:campaignId/chronicles/` | `chroniclesOverview` | chronicles page | Overview |
| `/c/:campaignId/chronicles/quests` | `chroniclesQuests` | chronicles page | Quest analytics |
| `/c/:campaignId/chronicles/party` | `chroniclesParty` | `campaign/chronicles/ChroniclesParty.tsx` | Per-member contribution |
| `/c/:campaignId/petitions` | `campaignPetitions` | `campaign/petitions/CampaignPetitions.tsx` | Owner inbox: triage bug/feature requests |
| `/c/:campaignId/blights` | `campaignBlights` | blights page | Crash-telemetry inbox (sigil-fed) |
| `/c/:campaignId/insights` | `campaignInsights` | insights page | Beacon / vitals analytics + per-environment error budget |
| `/c/:campaignId/q/:shortId` | `campaignQuest` | `campaign/quest/QuestView.tsx` | Quest detail (param is the integer `shortId`, not a UUID) |
| `/c/:campaignId/q/:shortId/graph` | `campaignQuestGraph` | `campaign/quest/QuestGraph.tsx` | Quest dependency graph |
| `/c/:campaignId/archive` | `campaignFolios` | `folios/FoliosLayout.tsx` | Folio + archive index (note: path is `/archive`, route name is still `campaignFolios`) |
| `/c/:campaignId/archive/new` | `campaignFoliosNew` | `folios/FolioCreatePage.tsx` | New folio |
| `/c/:campaignId/archive/:shortId` | `campaignFoliosFolio` | `folios/FolioView.tsx` | Folio detail |
| `/c/:campaignId/archive/:shortId/edit` | `campaignFoliosFolioEdit` | `folios/FolioEditPage.tsx` | Folio editor |
| `/c/:campaignId/settings` | `campaignSettings` | `campaign/settings/CampaignSettings.tsx` | Settings layout (sub-routes below) |
| `/c/:campaignId/settings/` | `campaignSettingsBanner` | `…/CampaignSettingsGeneralPage.tsx` | General / banner |
| `/c/:campaignId/settings/members` | `campaignSettingsMembers` | `…/CampaignSettingsMembersPage.tsx` | Members & pending invitations — the future home of per-member access rights |
| `/c/:campaignId/settings/zones` | `campaignSettingsZones` | `…/CampaignSettingsZonesPage.tsx` | Zones config |
| `/c/:campaignId/settings/kanban` | `campaignSettingsKanban` | `…/CampaignSettingsKanbanPage.tsx` | Kanban columns config |
| `/c/:campaignId/settings/folios` | `campaignSettingsFolios` | `…/CampaignSettingsFoliosPage.tsx` | Folios config |
| `/c/:campaignId/settings/quests` | `campaignSettingsQuests` | `…/CampaignSettingsQuestsPage.tsx` | Per-quest module toggles (note / chrono / reminder) |
| `/c/:campaignId/settings/sigils` | `campaignSettingsSigils` | `…/CampaignSettingsSigilsPage.tsx` | Sigil inventory + module toggles |
| `/c/:campaignId/settings/chapters` | `campaignSettingsChapters` | settings page | Chapter config |
| `/c/:campaignId/request` | `campaignPetitionRequest` | `campaign/petitions/CampaignPetitionRequest.tsx` | First-party petition form (login required). Top-level, **not** nested under the `campaign` layout — no membership check |

A reporter follows their own submissions at `/me/petitions` (`myPetitions`, declared in `src/web/app/components/profile/me/MeRouter.ts`, not in `AppRouter`). The old per-petition status page (`/c/:id/p/:petitionId`) was retired in its favour.

HTTP API routes follow the same vocabulary: `/campaigns/:id/export`, `/quests/attachments`, `/kanban/:campaignId`. MCP tools are `campaign_*`, `quest_*`, `chapter_*`, `folio_*`, `petition_*`.

## Key Patterns

### State Atoms

Live in `src/web/app/atoms/`. The campaign route loader fills the `current*` atoms on enter and clears them on leave — components inside the layout can read them without re-fetching.

**Per-campaign (set by `campaign` route loader)**
- `currentCampaignAtom` — campaign metadata
- `currentCampaignMemberAtom` — the viewer's membership row for this campaign
- `currentAssignedQuestsAtom` — quests assigned to the viewer
- `currentChaptersAtom` — chapter list

**Per-resource (set by their route loaders)**
- `currentQuestAtom` — active quest detail
- `currentFolioAtom` — active folio detail
- `currentPetitionCountAtom` — pending petitions badge for the campaign header
- `currentBlightCountAtom` — open blights badge for the campaign header

**Archive / folios index (set by the `campaignFolios` loader)**
- `userFoliosAtom`, `folioTagsAtom`
- `campaignDirectoriesAtom` — archive directory tree
- `currentArchivePathAtom` — breadcrumb chain for the active directory
- `currentArchiveContentsAtom` — folios + blobs in the active directory

**Global (per-user, not per-campaign)**
- `userCampaignsAtom` — sidebar/home campaign list
- `campaignOptionsAtom` — per-user campaign UI options
- `petitionOptionsAtom` — server-side rate-limit tunables (see Petitions section)

**Kanban ↔ Header communication (the pattern that needs explaining)**
- `kanbanCampaignAtom` — set by `KanbanBoard` on mount with `{ campaign }`; read by the Header so the "Create Quest" button can target the right campaign
- `kanbanReloadAtom` — bumped by the Header's create button (`CampaignActionsCreateButton.tsx`) to trigger a board reload

### Kanban ↔ Header Communication
The kanban board sets `kanbanCampaignAtom` with `{ campaign }`. The Header reads it to:
1. Show the campaign name in `HeaderCampaign` (falls back from `currentCampaignAtom`)
2. Show the Board/Kanban toggle button
3. Show the "Create Quest" button

After creating a quest from the header, it bumps `kanbanReloadAtom` which KanbanBoard watches to trigger a reload.

### QuestView Reusability
`QuestView` works in two contexts:
1. **Campaign page** — rendered as a route (`/c/:id/q/:questId`), reads from `currentCampaignAtom`, navigates via router
2. **Kanban drawer** — rendered inside a `Drawer`, receives `onClose` and `onQuestChange` callbacks

When `onClose` is provided, it's used instead of router navigation. When `onQuestChange` is provided, it's called on quest mutations so the parent can update its state.

### QuestCreate Navigation
`QuestCreate` accepts an optional `onCreated` callback. When provided, it's called instead of the default `router.push("campaignQuest", ...)` after creating a quest. Used by the kanban header to stay on the kanban page.

### Campaign access model
Lore campaigns are private. Every campaign-scoped endpoint goes through
`AppSecurityProvider.assertMember` (member-or-owner) or `assertOwner`
(creator-only). There is no anonymous or "any-logged-in-user can browse"
path — the old `campaign.public` flag was removed (the column is kept in
the schema only because dropping it on D1 triggers a cascade-wipe).

The single exception is the petition module: `submitPetition` and
`uploadPetitionAttachment` are gated on `campaign.features.petitions`
being on instead of membership, so any logged-in Lore user can submit
feedback to a campaign that opts in. The petition module toggle is the
owner's opt-in/out lever.

### Drag & Drop
Uses `@dnd-kit/core`. Cards are `useDraggable`, columns are `useDroppable`. Status transitions: `new → accepted → completed`. Completed quests cannot be moved back. New quests must be accepted before completing.

## Petitions

User-submitted bug reports / feature requests that the campaign owner triages.

**Lifecycle**: `pending → accepted` (promoted to a quest, linked via `promotedQuestId`) `| rejected`.

**Submission flow (login required)** — there are **two** live entry points; both land on `POST /campaigns/:id/petitions`:
- `/c/:campaignId/request` — first-party form on lore (`CampaignPetitionRequest.tsx`, route `campaignPetitionRequest`). Anonymous visitors see a sign-in CTA. Once logged in, they get the full form (title, description, type bug/feature, file uploads).
- External "report a bug" buttons on third-party sites are plain `<a target="_blank" rel="noopener noreferrer">` anchors pointing to `/c/:id/request?path=<encoded>&url=<encoded>&type=bug` — no embedded JS, no screenshot capture, no widget. The page reads query params, persists them to `sessionStorage` (key `lor.petition.draft.<campaignId>`), cleans the URL via `history.replaceState`, and re-reads after the OAuth round-trip. Cleared on successful submit.
> There is now **one** path plus external links. The screenshot-capturing in-app dialog is gone with the package rename. `@alepha/sigil` mounts nothing *automatically*; it ships an opt-in React surface at `@alepha/sigil/react` — `<SigilRoot />` (a floating feedback button that links out to the petition form) and `usePetitionUrl()` for an app that renders its own link. The subpath is condition-free so an SSR host resolves it on the server pass too.

**Reporter-facing views** — `/me/petitions` (own submissions across campaigns) and `/c/:id/p/:petitionId` (single status page, readable by the reporter or the campaign owner).

**Attachments**
- Uploaded one-at-a-time via `POST /campaigns/:id/petitions/attachments`. Returns a file id; the client collects ids and includes them in the petition body.
- Allowed types: png/jpg/jpeg/webp/gif/csv/txt/json/xlsx/xls/pdf. Both MIME and extension are checked (neither alone is trustworthy).
- 5 MB / file, 10 / petition.
- Stored in the `petition-attachments` bucket (`alepha/api/files`); the petition row carries `attachments: uuid[]` (mirrors `quests.attachments`).
- `assertAttachmentsBelongToUser` blocks cross-user file id reuse — the controller verifies every claimed attachment was uploaded by the same user.

**Rate limits — `petitionOptionsAtom`**
- `maxPetitionsPerUserPerDay: 5` — per user, across all campaigns.
- `maxAttachmentsPerUserPerDay: 50` — per user, across all petitions.
- `maxAttachmentsPerPetition: 10`, `maxFileSizeBytes: 5 MB`.
- All counts are DB-derived (no in-memory windows) so they survive restarts and are correct across workers.

**Visibility / access**
- Submit: any logged-in Lore user (no membership required), provided the campaign has `features.petitions === true`. The petition module toggle in campaign settings is the owner's opt-in/out lever.
- List/detail (read): any campaign member (`assertMember`). Triage — accept/reject/remove: campaign owner only (`assertOwner`). Same read-vs-mutate split applies to Blights and Insights (members can view the inbox / crash telemetry / analytics; owner-only actions stay gated).

**Where to look**
- Entity: `src/api/entities/petitions.ts`
- Controller: `src/api/controllers/PetitionController.ts` (submit, uploadAttachment, list, detail, accept, reject, remove)
- Rate limiter: `src/api/services/PetitionRateLimiter.ts`
- Tunables atom: `src/api/atoms/petitionOptionsAtom.ts`
- Inbox UI: `src/web/app/components/campaign/petitions/CampaignPetitions.tsx` (+ Card / Drawer / AcceptForm)
- Request UI: `src/web/app/components/campaign/petitions/CampaignPetitionRequest.tsx`
- Routes: `campaignPetitions` (under `campaign`), `campaignPetitionRequest` (top-level, not under the campaign layout — public landing)

## Folios are this campaign's memory for Claude

Folios are markdown notes scoped to a **campaign** and shared across all its members (they were per-user before quest #65) — they mirror the `~/.claude/projects/*/memory/MEMORY.md` pattern but at the campaign level: persistent across sessions, exportable, tagged, fully MCP-readable. Treat them as the canonical place where any agent working on a Lore campaign should look for context and write down what it learns.

**Conventions** (apply when curating folios — yourself or via Claude):

- One topic per folio. Use the title as the topic; use tags (`tech/decision`, `runbook`, `incident`, …) for taxonomy.
- Keep folios short and self-contained. A folio that needs scrolling is two folios.
- When an agent creates a folio via MCP, it should always provide useful `tags` AND a `summary` (1-2 sentences, ~200 chars) so future `folio_list` / `folio_search` calls stay precise and `campaign_context` returns a self-explanatory index. Web-created folios may leave `summary` empty — the index falls back to the title.
- Use `[[Folio Title]]` or `[[#shortId]]` syntax inside a folio's markdown to cross-link other folios. Links re-sync on every save; agents see them as `links.outbound` / `links.inbound` on `folio_get` and humans see a Connections panel under the folio view.

**MCP orientation flow** (every AI client should follow this on a fresh task):

1. `campaign_context` — one-shot orientation: campaign metadata + active quests + folio index (~2K tokens, no folio bodies).
2. `folio_get` / `quest_get` on the specific entries that look relevant.
3. `folio_create` / `folio_update` when the agent decides something worth remembering long-term.

The MCP tool descriptions in `src/mcp/tools/CampaignTools.ts` and `src/mcp/tools/FolioTools.ts` are the public-facing version of this convention — every Claude reads them on connect. Keep them sharp.

**Where to look**

- Entity: `src/api/entities/folios.ts` (campaign-scoped, `searchText` blob for cheap LIKE search — blank for protected folios, `summary` for agent-readable orientation)
- Link table: `src/api/entities/folioLinks.ts` (derived; re-synced from `[[...]]` references on every folio save)
- Link sync: `src/api/services/FolioLinkService.ts`
- Controller: `src/api/controllers/FolioController.ts` (list, listTags, getByShortId, get, getLinks, create, update, delete, listCampaignActivity, listHistory, revertHistory, pinHistory)
- History: `src/api/services/FolioHistoryService.ts` (append, retention sweep, protection-domain purge)
- MCP tools: `src/mcp/tools/FolioTools.ts` + `CampaignTools.ts` (`campaign_context`)
- UI: `src/web/app/components/folios/FolioEditor.tsx`, `FolioView.tsx`, `FolioBacklinksPanel.tsx`

### ⚠️ Protected folios: the protection-domain invariant

A folio with `protected: true` stores a client-side `BrowserCryptoProvider` envelope in `content`. The server never sees the passphrase or the plaintext.

**Invariant: `folio_revisions` never holds a snapshot from a different protection domain than the folio's current one.** Crossing the boundary in either direction purges the folio's revision history (`FolioHistoryService.purgeRevisions`, called from `FolioController.update` when `isProtected !== existing.protected`).

This is a **confidentiality requirement**, not a tidiness one. Before it existed, encrypting a folio blanked `searchText` and wiped the outbound links but left every pre-encryption plaintext snapshot in `folio_revisions` — readable by any campaign member through `GET /folios/:id/history`. Encrypting protected nothing already written. It also meant `revertHistory` could write a plaintext snapshot into a folio still flagged `protected`, leaving it undecryptable in the UI.

`pinned` revisions are exempt from the retention sweep but **not** from this purge. Regression guard: `test/folio-protected-history.spec.ts`.

## Sigils, Blights, Beacon, Vitals

A **sigil** is one environment of one application — `lore` in `production` is a different sigil from `lore` in `staging`, and they report separately, because an error budget shared between environments is nobody's budget. It authenticates with a `sg_`-prefixed bearer token, stored hashed and shown once at creation; `tokenPrefix` exists so the UI can name a credential it cannot reconstruct.

Managed at `/c/:id/settings/sigils` (`SigilController`, reads member-gated, mutations owner-gated — no role, no allowlist: owning the campaign is the whole gate). `features.sigils` is the master switch, with `petitions` / `blights` / `beacon` / `vitals` as the per-capability toggles `GET /sigils/config` reports back to the app.

**The toggles are enforced, not advertised.** `SigilIngestService.gatesFor` intersects the campaign's features with the sigil's `kinds`, and both `absorb` (the write gate) and `/sigils/config` (the advertisement) call it — one definition, so the sink cannot invite a payload it then discards. Enforcing on write is not redundant with the config poll: `sigils.kinds` is written once at creation and has **no update path anywhere**, and the reporting client fails open on any config error, so gating on the token alone left an owner's "off" switch as a suggestion.

**Rotate, don't delete.** All four aggregate tables cascade on `sigilId`, so deleting a sigil to revoke a leaked token also erases that environment's views, vitals, uniques and error groups. `rotateSigil` re-mints `tokenHash`/`tokenPrefix` in place — the old token stops resolving immediately (`verify` looks a sigil up *by* its hash) and every row survives. The UI says which is which; so do the MCP tool descriptions.

- **Blights** — one row per distinct failure, keyed by `fingerprint`, with a count. The owner triages them in the inbox (`/c/:id/blights`): resolve, ignore-by-rule (`blightIgnoreRules`), or **forward to a quest** (filed under the `Blights` zone, provenance recorded in `quests.source`). Purged on a retention window (`campaign.retentionDays ?? 30`) by `BlightJobs`; resolved and `quest:`-forwarded rows are kept as audit trail. A blight survives its sigil — `blights.sigilId` is `ON DELETE SET NULL`.
- **Insights** (`/c/:id/insights`, gated on `features.beacon`) — three segments over one payload: **Analytics** (page views, unique visitors), **Performance** (web-vitals p75) and **Errors** (the per-environment error budget), read out of `sigil_views_hourly` / `sigil_uniques_daily` / `sigil_vitals_hourly` / `sigil_error_groups`. Buckets are hourly so a 14:00 deploy is visible against 13:00; the daily timeline is a `substr(hour, 1, 10)` group over the same rows. `uniqueVisitors` is the trustworthy headline — nothing throttles what an app reports, so `totalViews` is inflatable by whoever holds the token.
  - The **Errors** segment is the only place `sigil_error_groups` is read. It answers "is this still happening *in production*", which the Blights inbox cannot: the inbox keys on `(campaignId, fingerprint)` so a triage decision does not fork, which necessarily merges staging into production. Filtered on `lastSeenAt` (still failing), ordered by `count`, capped at 20.

> ⚠️ **`name`, `message`, `stack`, `sourceUrl` on a blight are 100% attacker-controlled** and are shown to the campaign owner — the highest-value target. Render as escaped plain text only. Never markdown, never `dangerouslySetInnerHTML`.

Read endpoints are member-gated; mutations are owner-only. **Ingest has its own credential**: `POST /sigils/ingest` and `GET /sigils/config` (`SigilIngestController`, `$route` so they sit at the root) accept a sigil bearer token and nothing else — a logged-in member cannot post telemetry, and a sigil token opens nothing but those two routes.

**The reporting half is a package, not an app.** `packages/@alepha/sigil` is what an enrolled app imports; it reads `SIGIL_SINK` + `SIGIL_KEY` (the token minted above) from env, aggregates errors by fingerprint before they leave the process, and polls `/sigils/config` for a kill-switch it obeys immediately. The two wire paths are one definition (`@alepha/sigil/paths`) imported by both ends — the client fails open, so a path disagreement is silent in both directions and has drifted once already. Lore itself sets neither variable: it is the sink, and a Cloudflare Worker cannot fetch its own hostname.

**Where to look**

- Entities: `src/api/entities/sigils.ts` (the credential + `(campaignId, app, environment)` unique index), `blights.ts`, `sigilErrorGroups.ts`, `sigilViewsHourly.ts`, `sigilUniquesDaily.ts`, `sigilVitalsHourly.ts`
- Owner CRUD: `src/api/controllers/SigilController.ts` (create / list / rotate / delete)
- Ingest: `src/api/controllers/SigilIngestController.ts` + `src/api/services/SigilIngestService.ts`
- Credential: `src/api/services/SigilTokenService.ts` (mint / verify / bearer)
- Triage: `src/api/controllers/BlightController.ts`, `src/api/services/BlightRuleService.ts`, `src/api/jobs/BlightJobs.ts`
- Analytics: `src/api/controllers/InsightsController.ts`
- UI: `src/web/app/components/campaign/settings/CampaignSettingsSigilsPage.tsx` (+ `…SigilRow`, `…SigilToken`), `campaign/blights/CampaignBlights.tsx`, `campaign/insights/CampaignInsights.tsx` (+ `…Analytics`, `…Performance`, `…Errors`)
- MCP: `src/mcp/tools/SigilTools.ts`, `src/mcp/tools/BlightTools.ts`
- E2E: `e2e/sigil.spec.ts` — enrol → ingest → triage → rotate → delete, with ingest driven through Playwright's isolated `request` fixture (the page's `fetch` is patched to attach the session bearer, which would replace the sigil token)

## Archive (directories + blobs)

Folios live in a directory tree rather than nesting under each other. `archiveDirectories` is the tree (depth-capped at 8), `archiveBlobs` holds binary attachments, and `archiveNames` backs name-uniqueness. `folios.directoryId` is `undefined` for campaign root and **cascades on directory delete** — removing a directory removes everything in it, folios included.

Surfaced at `/c/:id/archive` and over MCP via `ArchiveTools`.

## I18n

Two languages: English (`en`) and French (`fr`). All translations in `src/web/app/services/I18n.ts`. Always use `tr()` from `useI18n<I18n, "en">()` — never hardcode strings.

## De-gamification (2026-07)

Lore has **no gamification currency**: no XP, no gold, no levels, no achievements, no titles, no per-campaign alias/avatar. All of it was removed in two passes (spec: `docs/superpowers/specs/2026-07-30-lore-degamification-design.md`):

- First pass killed the wall: `FeaturePaywallService` / Shop / `requiredLevel` quest gating. Ex-walled features (Chronicles, Quest Reminder, …) are plain `campaign.features.*` owner toggles.
- Second pass removed the remaining cosmetic progression and collapsed `characters` into `members` (migration `20260730154120_heavy_nova`: `ALTER TABLE characters RENAME TO members` + column drops — no rebuild, D1-safe). `CharacterInfo`, `AchievementEngine`, `CharacterController`, the character sheet, roster, XP bar and level-up animation are gone.

What survives, deliberately:

- **Quest rank letters F/C/B/A/S** — derived from quest difficulty 1–5 in `src/web/app/components/campaign/quest/questRank.ts`. A property of the task, never of the person.
- The RPG **vocabulary** (campaigns, quests, zones, folios, blights, sigils) — flavor, not mechanics.
- `campaigns.unlockedFeatures` / `unlockHistory` / `public` — **`@deprecated` dead columns**. Nothing reads or writes them; they stay because dropping a `campaigns` column risks the D1 rebuild path and `campaigns` is the CASCADE parent that wiped prod in 2026-05.

Do not reintroduce progression mechanics without an explicit decision — the goal is a neutral tool usable with other people; the metaphor describes the work, never the person.

## Key Dependencies

- `@dnd-kit/core` — drag & drop (kanban, quest board)
- `@mdxeditor/editor` — the shared WYSIWYG markdown editor (`src/web/app/components/shared/markdown-editor/MarkdownEditor.tsx`): lazy client-only, markdown-features-only, source-mode toggle, per-context image upload (folios → archive blobs; quests → attachments, embedded ids merged server-side by `QuestService.mergeEmbeddedAttachments`). Rendering stays `@alepha/ui` `MarkdownView`. The petition request form keeps a plain textarea (its own paste/drag attachment flow)
- `recharts` — chronicles charts
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

- **Avoid the rebuild entirely.** If the only change is a column *default* (the bomb we hit), move the default into the application handler — e.g. `createCampaign` injects `defaultCampaignFeatures` server-side — and drop the `db.default(...)` from the entity schema. Drizzle won't generate a rebuild migration for an app-layer default.
- **Manually rewrite the migration** to back child rows up into `__bk_*` tables before the `DROP`, then re-insert and drop the backups after `RENAME`. Tedious but correct.
- **Temporarily switch the CASCADE child(ren) to `onDelete: "set null"`** for the migration window if the children make sense without a parent — only viable when the FK column is nullable.

**Why local testing won't catch this:** `yarn v` uses in-memory SQLite, where `PRAGMA foreign_keys=OFF` actually works. The bomb only goes off on D1. Inspect the migration SQL manually.

**CI auto-deploys to prod on every push to `main`** (alepha monorepo's `.github/workflows/ci.yml` → `deploy-lore-production` job → `yarn alepha platform up --env production` from `apps/lore`). There is no human gate between push and prod migration. Treat every D1 migration as you would a `DROP DATABASE` — read every line before pushing.

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

49 unit / integration specs in `test/` (Vitest, in-memory SQLite). Notable ones:

- `mcp-security.spec.ts` — MCP auth, API keys, user isolation
- `campaign-stats.spec.ts` — chronicles aggregation
- `campaign-leave.spec.ts` — `leaveCampaign` (owner-forbidden, no-op, member removal)
- `campaign-features.spec.ts` — `campaign.features` toggle behavior + defaults
- `chapter-jobs.spec.ts` — chapter background work (open/close, scheduling)
- `quest-csv-*.spec.ts` — generic + format-specific CSV import/export, plus the Trello round-trip
- `quest-objective-history.spec.ts` — objective state history tracking
- `quest-reminder.spec.ts` — quest reminder/notification logic
- `folio-protected-history.spec.ts` — **regression guard**: the protection-domain invariant (no plaintext left in `folio_revisions` after encrypting; pinned revisions are not exempt)
- `folio-*.spec.ts` — links, backlinks, tidy, pinning, permissions, history, activity, blob links
- `sigil-controller.spec.ts` / `sigil-ingest.spec.ts` / `sigil-entities.spec.ts` — sigil CRUD + rotation, token verification, capability gating, aggregate upserts
- `insights-controller.spec.ts` — beacon/vitals windows and the p75 walk (clock pinned with `DateTimeProvider.pause()`)
- `blight-tools.spec.ts` — the MCP triage surface
- `archive-module.spec.ts` — directory tree + blobs
- Shared fixtures live in `test/fixtures/`

### E2E convention: one file per feature

`e2e/` is split by feature, not by user journey. One `<feature>.spec.ts` per major surface, each covering happy path + key edge cases:

- `sigil.spec.ts` — enrol an environment → ingest as it → triage in the inbox → rotate → delete
- `blights.spec.ts` — regression guard for the inbox render loop (the ingest path lives in `sigil.spec.ts`)
- `quest.spec.ts` — quest lifecycle (open → accept → complete) + reminder UI
- `petition.spec.ts` — petition submit → accept → link quests → status progression
- `register.spec.ts` — registration form + email verification
- `settings-features.spec.ts` — campaign feature toggles
- `theme-flicker.spec.ts` — theme no-flash boot
- `invitation.spec.ts` — owner invites → user accepts → joins campaign as a member (drives the email-link round-trip)
- `protected-folio.spec.ts` — end-to-end encrypted folios (passphrase round-trip, wrong-passphrase rejection, no plaintext on the wire)
- `quest-import-export.spec.ts` — Data settings page CSV export (import side is covered by the unit specs)
- `archive.spec.ts` — directory tree navigation + blob upload
- `blights.spec.ts` / `sigil.spec.ts` — sigil issuance, ingest, blight triage + forward-to-quest
- `campaign-wizard.spec.ts` — 3-step create wizard
- `members.spec.ts` — settings members list, identity hover-card, dead `/character` + `/roster` URLs 404
- `home.spec.ts`, `admin-user-detail.spec.ts`
- `security-public-campaign.spec.ts` — regression guard: non-member account hits 403 on every campaign endpoint after the public-campaign purge
- `security-file-access.spec.ts` — regression guard: `/api/files/:id` IDOR fix via `LoreFileAccessProvider` (only owners/members can download an attachment)

Shared setup (register/verify, campaign-create wizard, API helpers) lives in `e2e/_helpers.ts`. Re-use those rather than copy-pasting auth setup into each new spec.

`setCampaignFeature(page, campaignId, key, value?)` flips a campaign feature toggle from inside a flow — use it when a spec needs an off-by-default module (e.g. `questReminder`). It replaced the old `unlockShopFeature`, which farmed gold from a throwaway quest to fund a Shop purchase; the Shop no longer exists.

**When adding or modifying a feature, the matching `<feature>.spec.ts` must move with it.** No feature ships without its e2e moving in lockstep. If no spec exists yet for the feature, create one — start by composing `registerAndVerify` + `createCampaignViaWizard` from `_helpers.ts`, then drive the feature-specific UI.

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

Clears all campaigns, members, sessions, etc. Migrations auto-apply on boot. Optionally also `rm -rf node_modules/.alepha/emails/` to clear the inbox.

### Playwright tips

- Hostname is `localhost`, no HTTPS in dev/prod-like.
- The session cookie persists across reloads; if you need a clean slate, clear cookies via `context.clearCookies()` rather than relaunching the browser.
- Pages load lazily — wait for the visible text of a known route element (e.g. "Campaigns") before asserting.
- `claude-in-chrome` MCP works fine; the deferred `playwright` MCP is what most of the existing e2e specs target.

## Working on the framework while in this repo

Lore is a workspace member of the Alepha monorepo — there is no vendor step. Edit `../../packages/alepha/src/...` or `../../packages/@alepha/ui/src/...` directly; Vite HMR picks the change up immediately. Run `yarn v` from the monorepo root to verify framework + apps together before committing.

The same CI run that ships Alepha now also verifies Lore (because Lore is just another workspace under `yarn workspaces foreach`), and the `deploy-lore-production` job in `.github/workflows/ci.yml` ships Lore to Cloudflare on every push to `main`. So a single commit covers both sides — no cross-repo handoff, no sync drift to worry about.
