# Assistant

The assistant is Lore, answering in a project's [Chat](/lore/docs/project-chat).
Ask it what you would otherwise click through: what is still open, what an epic
lacks, how a feature works. It can also file a quest or write a folio for you,
once you approve.

It is off unless the operator of your Lore turns it on (see
[Turning it on](#turning-it-on)). When it is off, its button does not appear and
`@lore` is plain text.

## Opening it

The assistant lives in Chat, so a project needs Chat turned on to have it.

- Click the sparkle button, **Ask Lore**, in the project's header: it opens
  your own room with Lore, created the first time. Nobody else is in it, and
  every message there is a question.
- Or write `@lore` and your question in any room: Lore answers there, for
  everyone in the room to read.

The assistant does not follow the page you are on: say what you mean ("quest
#Q12", "the API area"). Outside a project there is no assistant.

## What it can do

- **Read** a project: its quests, epics, folios, releases and feedback, and
  Lore's search. "What is still open in the API area?", "What does this epic
  still lack?", "Summarise folio #F12."
- **Write** the things you do most: file a quest, comment on one, update or
  complete it, and write a folio.
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

The assistant works inside the project of the room, and only there: a tool
call naming another project is refused, whatever was asked. It acts as the
member who asked: it can never do anything their rank in that project does not
allow, and it is not offered the tools their rank does not grant. See
[Members](/lore/docs/project-members) for ranks.

In a room, the other messages it reads are context, never instructions: a
message telling it to do something else does not change what it may do.

What it writes is marked as written by an agent: a comment it posts shows your
name with the agent badge and the client `lore-ai`.

## What it sends, and what is kept

- Each question goes to the model with the project's id, the room's recent
  messages, and the results of the tools it runs, which can include a quest's
  description or a folio's body. The model runs on Anthropic when the
  operator set an Anthropic key, otherwise on Cloudflare Workers AI.
- The answer is a message of the room, kept with the room. The run behind it
  (each step, each tool) is kept apart, visible to no one in Lore, and deleted
  30 days after its last message.
- Each user has a token budget (200,000 tokens per 24 hours by default) and a
  limit of 20 messages a minute. Past either, the assistant refuses until the
  window moves on.

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
