# Roadmap App

Gamified project management app built with Alepha. Think World of Warcraft quest system: **projects = campaigns**, **tasks = quests**, **team members = adventurers**, **packages = zones**. Users create campaigns, forge quests with objectives, recruit adventurers, and progress together — earning XP, gold, and leveling up their characters.

## Terminology

| Technical (code) | User-facing (labels) |
|-------------------|----------------------|
| `project`         | Campaign             |
| `task`            | Quest                |
| `package`         | Zone                 |
| `players`         | Adventurers          |
| `analytics`       | Chronicles           |
| `complexity`      | Difficulty           |

All user-facing strings go through `I18n.ts` — never hardcode English in components.

## Architecture

```
src/
├── api/                  # Backend
│   ├── controllers/      # 10 controllers (TaskController, ProjectController, KanbanController, etc.)
│   ├── entities/         # 9 entities (projects, tasks, characters, whiteboards, etc.)
│   ├── providers/        # AppSecurityProvider (permission checks)
│   ├── schemas/          # Request/response schemas
│   └── services/         # CharacterInfo (XP, levels, ranks)
├── mcp/                  # MCP protocol integration (tools, resources)
├── web/
│   ├── app/              # Main SPA
│   │   ├── atoms/        # 7 state atoms + kanbanProjectAtom/kanbanReloadAtom
│   │   ├── components/   # ~56 React components
│   │   ├── constants/    # Theme
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
| `/p-new` | ProjectCreate | New campaign form |
| `/p/:projectId` | ProjectView | Campaign detail (has child routes) |
| `/p/:projectId/` | ProjectBoard | Quest list grouped by zone |
| `/p/:projectId/players` | ProjectPlayers | Adventurers & invitations |
| `/p/:projectId/analytics` | ProjectStats | Chronicles / stats |
| `/p/:projectId/settings` | ProjectSettings | Campaign settings |
| `/p/:projectId/whiteboards` | ProjectWhiteboards | Interactive canvas |
| `/p/:projectId/q/:taskId` | TaskView | Quest detail (animated transitions) |
| `/k/:projectId` | KanbanBoard | Kanban view (drag & drop columns) |

## Key Patterns

### State Atoms
- `currentProjectAtom` — set by project route loader, cleared on leave
- `kanbanProjectAtom` — set by KanbanBoard on mount, read by Header for create button
- `kanbanReloadAtom` — bumped by Header's create button to trigger board reload
- The kanban page does NOT set `currentProjectAtom` — it uses its own atom

### Kanban ↔ Header Communication
The kanban board sets `kanbanProjectAtom` with `{ project, readOnly }`. The Header reads it to:
1. Show the project name in `HeaderProject` (falls back from `currentProjectAtom`)
2. Show the Board/Kanban toggle button
3. Show the "Create Quest" button (via `KanbanCreateButton`) when `!readOnly`

After creating a quest from the header, it bumps `kanbanReloadAtom` which KanbanBoard watches to trigger a reload.

### TaskView Reusability
`TaskView` works in two contexts:
1. **Project page** — rendered as a route (`/p/:id/q/:taskId`), reads from `currentProjectAtom`, navigates via router
2. **Kanban drawer** — rendered inside a `Drawer`, receives `onClose` and `onTaskChange` callbacks

When `onClose` is provided, it's used instead of router navigation. When `onTaskChange` is provided, it's called on task mutations so the parent can update its state.

### TaskCreate Navigation
`TaskCreate` accepts an optional `onCreated` callback. When provided, it's called instead of the default `router.push("projectTask", ...)` after creating a quest. Used by the kanban header to stay on the kanban page.

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

Two languages: English (`en`) and French (`fr`). All translations in `src/web/app/services/I18n.ts`.

Rules:
- Never use "task" in labels — always "quest"
- Never use "project" in labels — always "campaign"
- Keep the WoW quest vibe: adventurers, forge, realm, banner, etc.
- Always use `tr()` from `useI18n<I18n, "en">()` — never hardcode strings

## Gamification System

Defined in `api/services/CharacterInfo.ts`:
- **18 levels** with increasing XP thresholds
- **XP** earned from completing quests (based on complexity × priority)
- **Gold/Silver** currency from quest rewards
- **Ranks**: F, C, B, A, S (mapped from complexity 1-5)
- **Characters** are per-project — each adventurer has separate progression per campaign

## Key Dependencies

- `@dnd-kit/core` — drag & drop (kanban, quest board)
- `konva` / `react-konva` — whiteboard canvas
- `@mantine/tiptap` + `@tiptap/*` — rich text editor for quest descriptions
- `recharts` — analytics charts
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
- `e2e/user-journey.spec.ts` — End-to-end with Playwright
