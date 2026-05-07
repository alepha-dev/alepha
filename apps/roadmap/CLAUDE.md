# Roadmap App

Gamified campaign management app built with Alepha. Think World of Warcraft quest system: users create **campaigns**, forge **quests** with objectives, recruit **adventurers**, and progress together — earning XP, gold, and leveling up their **characters** across **zones**.

The codebase used to use the technical names `project`/`task`/`package`/`players`/`analytics`/`complexity`. As of the great rename, code identifiers, DB tables, HTTP routes, MCP tools, and URL params all match the user-facing vocabulary: `campaign`/`quest`/`zone`/`adventurers`/`chronicles`/`difficulty`. There is no longer a translation layer.

All user-facing strings still go through `I18n.ts` for EN/FR localization.

## Architecture

```
src/
├── api/                  # Backend
│   ├── controllers/      # 10 controllers (QuestController, CampaignController, KanbanController, etc.)
│   ├── entities/         # 9 entities (campaigns, quests, characters, whiteboards, etc.)
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
| `/c-new` | CampaignCreate | New campaign form |
| `/c/:campaignId` | CampaignView | Campaign detail (has child routes) |
| `/c/:campaignId/` | CampaignBoard | Quest list grouped by zone |
| `/c/:campaignId/players` | CampaignAdventurers | Adventurers & invitations |
| `/c/:campaignId/chronicles` | CampaignStats | Chronicles / stats |
| `/c/:campaignId/settings` | CampaignSettings | Campaign settings |
| `/c/:campaignId/whiteboards` | CampaignWhiteboards | Interactive canvas |
| `/c/:campaignId/q/:questId` | QuestView | Quest detail (animated transitions) |
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
- `konva` / `react-konva` — whiteboard canvas
- `@mantine/tiptap` + `@tiptap/*` — rich text editor for quest descriptions
- `recharts` — chronicles charts
- `framer-motion` + `animate.css` — animations (level up, transitions)

## Commands

```bash
yarn w roadmap dev          # Dev server
yarn w roadmap build        # Production build
yarn w roadmap typecheck    # Type checking
yarn w roadmap db:generate  # Generate migrations
yarn w roadmap studio       # Database studio
yarn w roadmap e2e          # Playwright e2e tests
```

## Tests

- `test/mcp-security.spec.ts` — MCP auth, API keys, user isolation
- `test/campaign-stats.spec.ts` — campaign chronicles unit tests
- `e2e/user-journey.spec.ts` — End-to-end with Playwright
