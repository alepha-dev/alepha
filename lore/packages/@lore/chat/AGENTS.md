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

## The room list

One order for the whole project (`chat_rooms.position`): a rank with `chat:manage` drags a room, or moves it from the keyboard, as the project dock is reordered (`ProjectRail`), and `reorderChatRooms` stores every listed room's index. Rooms never placed follow, oldest first. Nothing said in a room moves it: the list was sorted by its last message until a sent message kept moving the open room to the top. Rooms quiet for a week, and archived ones, fold behind one row.

## Live

- **One socket per member**, `/ws/chat?roomId=<own user id>`, declared once in `src/schemas/ChatChannels.ts` for both sides: `ChatSocketController` serves it (`$secure` plus `canJoin` on the user's own id), `useChatFeed` subscribes to it. The browser module imports `AlephaWebSocket` and registers `ChatChannels` at boot: a page that injects either later meets a locked container.
- **Every frame is addressed by the server** (`ChatLive.send`) to `ChatAudience.of(room)`, read at send time: the privacy rule, and why a removed member stops receiving at once on Node and on Workers.
- **A send answers before its frames go** (#Q4112): on Workers each recipient is a Durable Object call, seconds for a project, so `ChatMessageService.send` stores the message and returns it, then sends `message.created` (and starts an `@lore` run) through `BackgroundTaskProvider`. The page shows the message as pending meanwhile. A spec reading a send's frames waits for `RecordingChatLive.created(id)`.
- **A frame is a hint.** The page's messages are one `useInfiniteQuery` entry (`["chat-messages", projectId, roomId]`) that frames are written into; the room list and unread counts are invalidated, at most once per half second. On every reconnection after the first, the page invalidates all three and reads the database again.

## Permissions

`chat:read` (Viewer), `chat:write` (Member), `chat:manage` (Admin), declared in core's `LorePermissions` and claimed by the capability's `permissionGroups`. Migration `chat_permissions` granted them to stored ranks and API keys.

## The agent

`@lore` (#Q3930) is declared here and answered by the app (the personal room of #Q3942 was removed by #Q3972: asking Lore alone is the app's dock, not a room):

- **`ChatResponderRegistry`** (server): a responder has a `name` (the mention handle), a `label`, `respond` and `resume`. A message naming a registered agent starts `ChatAgentRunner.start`.
- **`ChatAgentRunner`** runs in the background of the request that sent the mention (`BackgroundTaskProvider`), with its own 5-minute signal, inside `McpProjectScope.pinned(room.projectId)`. It writes the answer into an agent message (`agentRun`: status, mentioner, tool trace, the paused write), stored as it grows so a reload mid-answer shows the text so far. On Workers it has the `waitUntil` window (about 30 s); a run cut short is stored as failed.
- **`ChatAgentUiRegistry`** (web): the tool labeller and the write cards an answer is drawn with; the app lends the assistant's own.
- **One run per room and member**, failures stored as an answer, an agent's message never starts a run (it never goes through `send`).

## Notifications and lifecycle

- **Mentions** notify through core's `inboxMention` template (`ChatMentionNotifier`), after a 5-second grace in which a member reading the room marks it read and is skipped; never through `ProjectEvents`.
- **`ChatLifecycle`**: project deletion removes files, reactions, mentions, members, messages and rooms, re-runnable; account deletion removes the member's memberships, mentions and reactions and keeps their messages without an author. `ChatRoomMerge` moves rooms on a merge (`general (2)` on a collision).
