# Chat

Chat is where a project's members talk: to each other, and to Lore's
assistant. It is a capability, like Plan or Ship: a project has it once
someone turns it on, in the creation wizard or later in
**Settings ▸ General ▸ Capabilities**. A project that existed before Chat
starts without it.

## Rooms

Open **Chat** in the project's sidebar. The page lists the project's rooms on
the left and the room you opened on the right; the sidebar folds to icons
while you are there, and its button brings it back.

- Every project with Chat has **general**, created when Chat is turned on.
- A room is **open** or **private**. An open room is for everyone in the
  project who reads chat. A private room is for its members only: to anyone
  else it does not exist, in the list, by its link, in notifications and for
  agents.
- **Create a room** with the **+** above the list: a name (lowercase letters,
  digits and hyphens) and whether it is private. You are its first member.
- The list puts rooms with something unread first, then the most recently
  active. Rooms nobody has written in for a week fold behind **Show N quiet
  rooms**. **All**, **Unread** and **Private** filter it.
- The room's name at the top of the conversation opens a list of every room
  you can see, to jump to another.
- A room's link is `/<project>/chat/<room>`.

On a phone, the list and the conversation are two screens.

## Members of a room

The people button at the top right of a room opens its panel:

- **Join** an open room to follow it; **Leave** it when you are done.
- In a private room, its members **invite** other project members, and its
  creator or a rank with chat management **removes** them. Someone removed
  stops seeing the room at once.
- **Notify me**: when you are mentioned (the default), or never.
- The room's creator, or a rank with chat management, **renames** and
  **archives** it. An archived room stays readable and takes no new message.

## Writing

The box at the bottom sends with **Enter**; **Shift+Enter** starts a new line.
Messages are Markdown, 4,000 characters at most, and arrive for everyone in
the room as they are sent.

- **Mentions.** Type `@` to pick a member who can see the room: they are
  notified (see [Notifications](#notifications)). In a private room you can
  only mention its members.
- **References.** `#Q12`, `#E3` or `#F7` link to that quest, epic or folio.
- **Files.** Attach with the paper clip, by pasting, or by dropping a file on
  the text: images show in the message, other files as a link. A private
  room's files open for its members only.
- **Reactions.** The smile beside a message adds one of six emoji; click a
  reaction again to take yours back.
- **Edit and delete** your own messages from their menu. An edited message
  says so. A deleted one leaves a line saying it was deleted. A rank with chat
  management deletes anyone's.

While someone else types in the room you see it under the conversation.

## Asking Lore

When the assistant is on for your Lore (see
[Assistant](/lore/docs/agents-assistant)), write `@lore` followed by your
question in any room. Lore answers in the room, where everyone can read the
answer:

- It runs **as you**: it can only do what your rank allows, and its usage
  counts against your budget, or the project's AI budget for agents when it
  has one (see [Chat agents](/lore/docs/project-chat-agents)).
- It reads **this project only**, and this room's recent messages. What
  other people wrote is context for it, never instructions.
- The line under its name traces what it is doing: the tools it runs, then
  what it ran.
- A **write** (filing a quest, a comment, a folio) waits for a card. Everyone
  sees the card; only you, who asked, can approve or decline it.

A project can also define its own agents, each with a name, an avatar, a
playbook and a model: see [Chat agents](/lore/docs/project-chat-agents).

To ask Lore something on your own, about the page you are on, open the
[Assistant](/lore/docs/agents-assistant) from the chat button in the header,
**Talk to Lore**, instead.

## Notifications

A mention reaches the member who is away: an item in their bell, and an email
if their notification settings ask for one. It links to the room. Someone who
has the room open when the message arrives is not notified, nor is anyone who
muted the room. A mention added by an edit notifies once.

The Chat row in the sidebar counts what is unread in the project's rooms you
are in, muted rooms left out, and shows `@` when some of it mentions you.

## Ranks

| Permission      | Lets a member                                                 |
| --------------- | ------------------------------------------------------------- |
| **Read chat**   | Read the open rooms and the private rooms they are in.        |
| **Write chat**  | Write, create rooms, join open ones, invite to private ones.  |
| **Manage chat** | Rename and archive any room, remove members, delete messages. |

Viewers read; members write; admins manage. See
[Members](/lore/docs/project-members).

## From the command line

`lore chat room list`, `lore chat message list <room>` and
`lore chat message send <room> <text>` read and post as you, so a script can
report into a room. A sent `@lore` asks Lore with your rights. See the
[CLI reference](/lore/docs/reference-cli).

## From an agent

Over MCP, `chat_room_list`, `chat_message_list` and `chat_message_send` do the
same. See [MCP tools](/lore/docs/reference-mcp-tools).
