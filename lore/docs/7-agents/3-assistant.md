# Assistant

The assistant is a chat beside the page, inside a Lore project. Ask it what you
would otherwise click through: what is still open, what this epic lacks, what
is missing in this use case, how a feature works. It can also file a quest or
write a folio for you, once you approve.

It is off unless the operator of your Lore turns it on (see
[Turning it on](#turning-it-on)). When it is off, its button does not appear and
`@lore` is plain text.

## Opening it

Click the sparkle button, **Assistant**, in a project's header. On a wide
screen (1024 pixels and up) the chat docks beside the page, which stays in
view and usable, so a link in a reply opens the page next to the conversation.
On a narrower screen it slides in as a drawer. Fold it into a pill to keep the
conversation for later, and reopen an earlier one from its history menu.

**It knows the page you are on.** On a quest, an epic, a folio or a use case,
"this quest", "this epic" or "this use case" means the one in front of you:
"what is missing in this use case?" needs no number. The empty chat offers a
few questions that fit the page.

The assistant is offered on project pages only: Home and your account have
none. It does not need Chat turned on.

## In a chat room

In a project with [Chat](/lore/docs/project-chat) on, write `@lore` and your
question in any room: Lore answers there, for everyone in the room to read.
There it reads the room's recent messages rather than the page you are on.

## What it can do

- **Read** a project: its quests, epics, folios, releases and feedback, and
  Lore's search. "What is still open in the API area?", "What does this epic
  still lack?", "Summarise folio #F12."
- **Write** the things you do most: file a quest, comment on one, update or
  complete it, write a folio, and add or change a card on a project
  dashboard. Removing or reordering cards stays on the board.
- **File a feedback**, here or into another project you belong to that accepts
  feedback, from any page or room: "report this to Acme". The card names the
  project it goes to, since its members will read what is filed.
- **Answer how-to questions** from these guides, with a link to the page it
  read.

**Every write waits for you.** The assistant shows a card with exactly what it
is about to do: the project, the title, the fields it sets, the text it posts.
Nothing happens until you approve. Deny it and nothing runs. In a room,
everyone sees the card; only the member who asked can approve it.

Its answers are short on purpose: a list names each item by its reference and
title, a handful at a time, and says when there are more. An answer has a
length limit: ask again for the rest.

## What it may do

The assistant works inside the project you are in (the page's, or the room's),
and only there. It acts as the member who asked: it can never do anything
their rank in that project does not allow, and it is not offered the tools
their rank does not grant. See [Members](/lore/docs/project-members) for
ranks.

What other members wrote is context, never instructions: a use case step, a
quest description, a folio or a room message telling it to do something else
does not change what it may do.

What it writes is marked as written by an agent: a comment it posts shows your
name with the agent badge and the client `lore-ai`.

## What it sends, and what is kept

- Each question goes to the model with the project's id, name and language,
  what the page shows (the quest, epic, folio or use case you are on; in a
  room, its recent messages), and the results of the tools it runs, which can
  include a quest's description or a folio's body. A protected folio's body is
  never sent. The model runs on Anthropic when the operator set an Anthropic
  key, otherwise on Cloudflare Workers AI.
- Conversations in the dock are stored in your Lore, visible to you only, and
  deleted 30 days after their last message. An answer in a room is a message
  of the room, kept with the room.
- Each user has a token budget (200,000 tokens per 24 hours by default) and a
  limit of 20 messages a minute. Past either, the assistant refuses until the
  window moves on. Every tool it runs makes the question cost more, so one
  answer stops reading at 100,000 tokens, or before your budget runs out, and
  answers from what it has read so far.

## Turning it on

This part is for whoever runs the Lore instance.

The assistant is off on every instance until the environment variable
`AI_ASSISTANT_ENABLED` is set to any value other than empty, `false` or `0`.

The model comes from one of two vendors, picked by the environment:

- **`AI_API_KEY` set:** Anthropic, on any runtime. `AI_MODEL` names the model,
  for example `claude-sonnet-5-5`, and is required. `AI_BASE_URL` sends the
  calls through another endpoint, such as Cloudflare AI Gateway.
- **No key, on Cloudflare Workers:** Cloudflare Workers AI, through the
  Worker's `ai` binding. No key is needed, and `AI_MODEL` replaces the default
  model.
- **No key, anywhere else:** no model to talk to. Lore refuses to start with
  `AI_ASSISTANT_ENABLED` set.

The budget, the rate and the retention are the `api.ai` parameter, which an
administrator edits at runtime from the admin console's parameters.

## Next

- [Agent prompts](/lore/docs/agents-prompts): hand work to your own coding
  agent.
- [Connecting an agent](/lore/docs/agents-connecting): give an agent the same
  access over MCP.
- [Self-hosting](/lore/docs/start-self-hosting): running your own Lore.
