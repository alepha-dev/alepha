# Assistant

The assistant is a chat inside a Lore project. Ask it what you would otherwise
click through: what is still open, what an epic lacks, how a feature works. It
can also file a quest or write a folio for you, once you approve.

It is off unless the operator of your Lore turns it on (see
[Turning it on](#turning-it-on)). When it is off, its button does not appear.

## Opening it

Click the sparkle button, **Assistant**, in a project's header. On a wide
screen (1024 pixels and up) the chat docks beside the page, so a link in a
reply opens the page next to the conversation. On a narrower screen it slides
in as a drawer. Fold it into a pill to keep the conversation for later.

The assistant is offered on project pages only: Home and your account have
none.

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
Nothing happens until you approve. Deny it and nothing runs.

Its answers are short on purpose: a list names each item by its reference and
title, a handful at a time, and says when there are more. An answer has a
length limit. When one reaches it, the assistant says the answer was cut short
and offers to continue, so a reply that stops early is never shown as complete.

## What it may do

The assistant works inside the project you are looking at, and only there. It
acts as you: it can never do anything your rank in that project does not allow,
and it is not offered the tools your rank does not grant. See
[Members](/lore/docs/project-members) for ranks.

What it writes is marked as written by an agent: a comment it posts shows your
name with the agent badge and the client `lore-ai`.

## What it sends, and what is kept

- Each message goes to the model with the page you are on (the project's id,
  name and language) and the results of the tools it runs, which can include a
  quest's description or a folio's body. The model runs on Anthropic when the
  operator set an Anthropic key, otherwise on Cloudflare Workers AI.
- Conversations are stored in your Lore, visible to you only, and deleted 30
  days after their last message.
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
