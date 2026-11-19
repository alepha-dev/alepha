# AGENTS.md: @lore/chat

**Chat** (#E161, design folio #F1528): project rooms, where members talk to each other and to the Lore agent. The fourth capability, `chat`, chosen in the project creation wizard and switched in Settings. It imports `@lore/core` only (`check:conventions`, `scripts/lore-package-graph.ts`). Read the repository's `AGENTS.md` first, then `packages/@lore/core/AGENTS.md`.

## Layout

`src/api` (module `LoreChatApi`), `src/mcp` (`LoreChatMcp`), `src/web` (`LoreChatWeb`, which injects `ChatRouter` and `ChatShell` from `register()`), `src/schemas`. Strings live in core's locales, like every package's.

## Routes

| Path                 | Route name    | Page (lazy)               |
| -------------------- | ------------- | ------------------------- |
| `/:projectSlug/chat` | `projectChat` | `components/ChatPage.tsx` |

The page 404s when the project has chat off or the rank lacks `chat:read`.

## Permissions

`chat:read` (Viewer), `chat:write` (Member), `chat:manage` (Admin), declared in core's `LorePermissions` and claimed by the capability's `permissionGroups`. Migration `chat_permissions` granted them to stored ranks and API keys.
