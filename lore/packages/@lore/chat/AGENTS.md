# AGENTS.md: @lore/chat

**Chat** (#E161, design folio #F1528): project rooms, where members talk to each other and to the Lore agent. The fifth capability, `chat`, chosen in the project creation wizard and switched in Settings. It imports `@lore/core` only (`check:conventions`, `scripts/lore-package-graph.ts`). Read the repository's `AGENTS.md` first, then `packages/@lore/core/AGENTS.md`.

## Layout

`src/api` (module `LoreChatApi`), `src/mcp` (`LoreChatMcp`), `src/web` (`LoreChatWeb`, which injects `ChatRouter` and `ChatShell` from `register()`), `src/schemas`. Strings live in core's locales, like every package's.

## Routes

| Path                       | Route name        | Page (lazy)               |
| -------------------------- | ----------------- | ------------------------- |
| `/:projectSlug/chat`       | `projectChat`     | `components/ChatPage.tsx` |
| `/:projectSlug/chat/:room` | `projectChatRoom` | `components/ChatPage.tsx` |

Both 404 when the project has chat off or the rank lacks `chat:read`. A room is named in the URL by its name, unique in its project; with none, a wide screen opens `general` and a phone shows the room list.

## Live

- **One socket per member**, `/ws/chat?roomId=<own user id>`, declared once in `src/schemas/ChatChannels.ts` for both sides: `ChatSocketController` serves it (`$secure` plus `canJoin` on the user's own id), `useChatFeed` subscribes to it. The browser module imports `AlephaWebSocket` and registers `ChatChannels` at boot: a page that injects either later meets a locked container.
- **Every frame is addressed by the server** (`ChatLive.send`) to `ChatAudience.of(room)`, read at send time: the privacy rule, and why a removed member stops receiving at once on Node and on Workers.
- **A frame is a hint.** The page's messages are one `useInfiniteQuery` entry (`["chat-messages", projectId, roomId]`) that frames are written into; the room list and unread counts are invalidated, at most once per half second. On every reconnection after the first, the page invalidates all three and reads the database again.

## Permissions

`chat:read` (Viewer), `chat:write` (Member), `chat:manage` (Admin), declared in core's `LorePermissions` and claimed by the capability's `permissionGroups`. Migration `chat_permissions` granted them to stored ranks and API keys.
