# Lore App

Gamified campaign management app built with Alepha. Think World of Warcraft quest system: users create **campaigns**, forge **quests** with objectives, recruit **adventurers**, and progress together — earning XP, gold, and leveling up their **characters** across **zones**.

The codebase used to use the technical names `project`/`task`/`package`/`players`/`analytics`/`complexity`. As of the great rename, code identifiers, DB tables, HTTP routes, MCP tools, and URL params all match the user-facing vocabulary: `campaign`/`quest`/`zone`/`adventurers`/`chronicles`/`difficulty`. There is no longer a translation layer.

All user-facing strings still go through `I18n.ts` for EN/FR localization.

## Architecture

```
src/
├── api/                  # Backend
│   ├── controllers/      # 10 controllers (QuestController, CampaignController, KanbanController, etc.)
│   ├── entities/         # entities (campaigns, quests, characters, etc.)
│   ├── providers/        # AppSecurityProvider (permission checks)
│   ├── schemas/          # Request/response schemas
│   └── services/         # CharacterInfo (XP, levels, ranks)
├── mcp/                  # MCP protocol integration (tools, resources)
├── web/
│   ├── app/              # Main SPA
│   │   ├── atoms/        # state atoms incl. kanbanCampaignAtom/kanbanReloadAtom
│   │   ├── components/   # ~56 React components
│   │   ├── services/     # I18n (EN + FR), Toaster
│   │   └── AppRouter.ts  # All routes
│   └── admin/            # Admin UI module
├── main.server.ts        # Server entry (API + MCP + Web + Admin)
└── main.browser.ts       # Browser entry (Web + Admin)
```

## Routes

| Path | Page | Notes |
|------|------|-------|
| `/` | Home | Campaign list |
| `/new-campaign` | CampaignCreate | New campaign form |
| `/c/:campaignId` | CampaignView | Campaign detail (has child routes) |
| `/c/:campaignId/` | CampaignBoard | Quest list grouped by zone |
| `/c/:campaignId/players` | CampaignAdventurers | Adventurers & invitations |
| `/c/:campaignId/chronicles` | CampaignStats | Chronicles / stats |
| `/c/:campaignId/settings` | CampaignSettings | Campaign settings |
| `/c/:campaignId/q/:questId` | QuestView | Quest detail (animated transitions) |
| `/c/:campaignId/petitions` | CampaignPetitions | Owner inbox: triage user-submitted bug/feature requests |
| `/c/:campaignId/request` | CampaignPetitionRequest | First-party petition form (login required) |
| `/k/:campaignId` | KanbanBoard | Kanban view (drag & drop columns) |

HTTP API routes follow the same vocabulary: `/campaigns/:id/export`, `/quests/attachments`, `/kanban/:campaignId`. MCP tools are `campaign_*`, `quest_*`, `chapter_*`, `folio_*`.

## Key Patterns

### State Atoms
- `currentCampaignAtom` — set by campaign route loader, cleared on leave
- `kanbanCampaignAtom` — set by KanbanBoard on mount, read by Header for create button
- `kanbanReloadAtom` — bumped by Header's create button to trigger board reload
- The kanban page does NOT set `currentCampaignAtom` — it uses its own atom

### Kanban ↔ Header Communication
The kanban board sets `kanbanCampaignAtom` with `{ campaign, readOnly }`. The Header reads it to:
1. Show the campaign name in `HeaderCampaign` (falls back from `currentCampaignAtom`)
2. Show the Board/Kanban toggle button
3. Show the "Create Quest" button (via `KanbanCreateButton`) when `!readOnly`

After creating a quest from the header, it bumps `kanbanReloadAtom` which KanbanBoard watches to trigger a reload.

### QuestView Reusability
`QuestView` works in two contexts:
1. **Campaign page** — rendered as a route (`/c/:id/q/:questId`), reads from `currentCampaignAtom`, navigates via router
2. **Kanban drawer** — rendered inside a `Drawer`, receives `onClose` and `onQuestChange` callbacks

When `onClose` is provided, it's used instead of router navigation. When `onQuestChange` is provided, it's called on quest mutations so the parent can update its state.

### QuestCreate Navigation
`QuestCreate` accepts an optional `onCreated` callback. When provided, it's called instead of the default `router.push("campaignQuest", ...)` after creating a quest. Used by the kanban header to stay on the kanban page.

### User Resolution Without `$secure`
`KanbanController.getBoard` doesn't use `$secure` (to support public campaigns). It mirrors `$secure`'s resolution pattern manually:
1. Check `currentUserAtom` from store
2. Fall back to `alepha.store.get("alepha.http.request")`
3. Check `httpRequest.user`
4. Call `resolveUserFromServerRequest(httpRequest)`
5. Catch all — unauthenticated is fine for public campaigns

### Drag & Drop
Uses `@dnd-kit/core`. Cards are `useDraggable`, columns are `useDroppable`. Status transitions: `new → accepted → completed`. Completed quests cannot be moved back. New quests must be accepted before completing.

## Petitions

User-submitted bug reports / feature requests that the campaign owner triages.

**Lifecycle**: `pending → accepted` (promoted to a quest, linked via `promotedQuestId`) `| rejected`.

**Submission flow (login required)**
- `/c/:campaignId/request` — first-party form on lore. Anonymous visitors see a "Sign in with Google" CTA. Once logged in, they get the full form (title, description, type bug/feature, file uploads).
- External "report a bug" buttons on third-party sites are plain `<a target="_blank" rel="noopener noreferrer">` anchors pointing to `/c/:id/request?path=<encoded>&url=<encoded>&type=bug` — no embedded JS, no screenshot capture, no widget. The page reads query params, persists them to `sessionStorage` (key `lor.petition.draft.<campaignId>`), cleans the URL via `history.replaceState`, and re-reads after the Google OAuth round-trip. Cleared on successful submit.
- One POST to `/campaigns/:id/petitions` after the user fills the form.

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
- Submit: any logged-in user who can see the campaign (`AppSecurityProvider.checkOwnership` — owner OR public OR member).
- List/detail/accept/reject/remove: campaign owner only.
- The schema carries no per-campaign petition settings — every campaign accepts petitions.

**Where to look**
- Entity: `src/api/entities/petitions.ts`
- Controller: `src/api/controllers/PetitionController.ts` (submit, uploadAttachment, list, detail, accept, reject, remove)
- Rate limiter: `src/api/services/PetitionRateLimiter.ts`
- Tunables atom: `src/api/atoms/petitionOptionsAtom.ts`
- Inbox UI: `src/web/app/components/campaign/petitions/CampaignPetitions.tsx` (+ Card / Drawer / AcceptForm)
- Request UI: `src/web/app/components/campaign/petitions/CampaignPetitionRequest.tsx`
- Routes: `campaignPetitions` (under `campaign`), `campaignPetitionRequest` (top-level, not under the campaign layout — public landing)

## I18n

Two languages: English (`en`) and French (`fr`). All translations in `src/web/app/services/I18n.ts`. Always use `tr()` from `useI18n<I18n, "en">()` — never hardcode strings.

## Gamification System

Defined in `api/services/CharacterInfo.ts`:
- **18 levels** with increasing XP thresholds
- **XP** earned from completing quests (based on difficulty × priority)
- **Gold/Silver** currency from quest rewards
- **Ranks**: F, C, B, A, S (mapped from difficulty 1-5)
- **Characters** are per-campaign — each adventurer has separate progression per campaign

## Key Dependencies

- `@dnd-kit/core` — drag & drop (kanban, quest board)
- `@mantine/tiptap` + `@tiptap/*` — rich text editor for quest descriptions
- `recharts` — chronicles charts
- `framer-motion` + `animate.css` — animations (level up, transitions)

## Commands

```bash
yarn w lore dev          # Dev server
yarn w lore build        # Production build
yarn w lore typecheck    # Type checking
yarn w lore db:generate  # Generate migrations
yarn w lore studio       # Database studio
yarn w lore e2e          # Playwright e2e tests
```

## ⚠️ Migration safety on D1 (production-data bomb, real incident)

`apps/lore` deploys to Cloudflare D1, which **ignores `PRAGMA foreign_keys=OFF`**. Drizzle-kit's auto-generated SQLite migrations use the standard rebuild pattern (`CREATE __new`, `INSERT FROM SELECT`, `DROP old`, `RENAME`). On D1, the `DROP old` step triggers `ON DELETE CASCADE` on every referencing child row.

**This already cost us all of lore-production once** (2026-05-13, migration `0023_special_purifiers.sql` flipping campaign feature defaults — `DROP TABLE campaigns` cascade-wiped `characters`, `quests`, `chapters`, `folios`, `petitions`). Recovered from D1 backup. Tracked upstream as [drizzle-team/drizzle-orm#4938](https://github.com/drizzle-team/drizzle-orm/issues/4938), no fix shipped.

**Hard rule before pushing any commit that adds a new migration under `apps/lore/migrations/sqlite/`:**

1. `grep "^DROP TABLE" apps/lore/migrations/sqlite/<newest>.sql` — no match? Safe to push.
2. Match found? Identify the table, then `grep -rn "<table>.cols.id" apps/lore/src/api/entities/` to find children.
3. **If any child has `onDelete: "cascade"` referencing the dropped table, the migration is a bomb on D1. Do not push as-is.**

Mitigations, in order of preference:

- **Avoid the rebuild entirely.** If the only change is a column *default* (the bomb we hit), move the default into the application handler — e.g. `createCampaign` injects `defaultCampaignFeatures` server-side — and drop the `db.default(...)` from the entity schema. Drizzle won't generate a rebuild migration for an app-layer default.
- **Manually rewrite the migration** to back child rows up into `__bk_*` tables before the `DROP`, then re-insert and drop the backups after `RENAME`. Tedious but correct.
- **Temporarily switch the CASCADE child(ren) to `onDelete: "set null"`** for the migration window if the children make sense without a parent — only viable when the FK column is nullable.

**Why local testing won't catch this:** `yarn v` uses in-memory SQLite, where `PRAGMA foreign_keys=OFF` actually works. The bomb only goes off on D1. Inspect the migration SQL manually.

**CI auto-deploys lore to prod on every push to `main`** (`.github/workflows/ci.yml` → `yarn w lore alepha platform up --env production`). There is no human gate between push and prod migration. Treat every D1 migration as you would a `DROP DATABASE` — read every line before pushing.

## Tests

- `test/mcp-security.spec.ts` — MCP auth, API keys, user isolation
- `test/campaign-stats.spec.ts` — campaign chronicles unit tests
- `test/campaign-leave.spec.ts` — leaveCampaign action (owner-forbidden, no-op, member removal)
- `e2e/*.spec.ts` — End-to-end with Playwright (one file per big feature)

### E2E convention: one file per feature

`apps/lore/e2e/` is split by feature, not by user journey. One `<feature>.spec.ts` per major surface, each covering happy path + key edge cases:

- `quest.spec.ts` — quest lifecycle (open → accept → complete)
- `petition.spec.ts` — petition submit → accept → link quests → status progression
- `register.spec.ts` — registration form + email verification
- `settings-features.spec.ts` — campaign feature toggles
- `theme-flicker.spec.ts` — theme no-flash boot

Shared setup (register/verify, campaign-create wizard, API helpers) lives in `e2e/_helpers.ts`. Re-use those rather than copy-pasting auth setup into each new spec.

**When adding or modifying a feature, the matching `<feature>.spec.ts` must move with it.** No feature ships without its e2e moving in lockstep. If no spec exists yet for the feature, create one — start by composing `registerAndVerify` + `createCampaignViaWizard` from `_helpers.ts`, then drive the feature-specific UI.

## Manual testing via Playwright (Claude)

When you need to drive the app yourself with the Playwright MCP, use these shortcuts.

### Servers

| Mode | Command | URL | Database |
|---|---|---|---|
| **Dev** (HMR, no build) | `yarn w lore dev` | http://localhost:5173 | `node_modules/.alepha/sqlite.db` (persistent) |
| **Prod-like** (build + run) | `yarn w lore start` | http://localhost:3000 | in-memory (`DATABASE_URL=:memory:`) — wiped on restart |

Dev mode is what you usually want — it keeps state between runs and emails accumulate on disk.

### Accounts

The realm admin (`apps/lore/.env` → `ADMIN_EMAIL=ni.foures@gmail.com`) is auto-bootstrapped on first start. Use that for owner/admin flows.

To test a fresh signup:

1. POST `/auth/register` via the UI with a throwaway email like `feat$(date +%s)@example.com`.
2. The verification email lands as a JSON file in `node_modules/.alepha/emails/<email>,<timestamp>.eml.json` — open it, grab the `verify` URL from the HTML body, and load it in the browser to confirm.
3. Same flow for password reset (`/auth/reset-password`).

### Mail inbox

There's no SMTP — dev mode persists every sent email as JSON under `node_modules/.alepha/emails/`. Filename is `<recipient>,<ISO timestamp>.eml.json`. Read with `cat`/`jq`, scrape links with `grep -oE 'href="[^"]+"'`.

### Reset the dev database

```bash
rm /Users/nfo/git/alepha/apps/lore/node_modules/.alepha/sqlite.db
yarn w lore dev   # recreates + runs migrations from migrations/sqlite/
```

Clears all campaigns, characters, sessions, etc. Migrations auto-apply on boot. Optionally also `rm -rf node_modules/.alepha/emails/` to clear the inbox.

### Playwright tips

- Hostname is `localhost`, no HTTPS in dev/prod-like.
- The session cookie persists across reloads; if you need a clean slate, clear cookies via `context.clearCookies()` rather than relaunching the browser.
- Pages load lazily — wait for the visible text of a known route element (e.g. "Campaigns") before asserting.
- `claude-in-chrome` MCP works fine; the deferred `playwright` MCP is what most of the existing e2e specs target.
