# Assistant

The **assistant** is a chat inside Lore. Open it from the sparkle button in the
header: from 1024px up it docks beside the page, so a link in a reply opens the
page next to the conversation; on a narrower screen it slides in as a drawer.
Fold it into a pill to keep the conversation for later.

It is off unless the operator of your Lore turns it on (see
[Turning it on](#turning-it-on)). When it is off, the button does not appear.

## What it can do

Ask it what you would otherwise click through:

- **Read** a project: its quests, epics, folios, releases and feedback, and
  Lore's search. "What is still open in the API area?", "What does this epic
  still lack?", "Summarise folio #F12."
- **Write** the things you do most: file a quest, comment on one, update or
  complete it, and write a folio. Every write waits for you: the assistant
  shows a card with exactly what it is about to do (the project, the title,
  the fields it sets, the text it posts), and nothing happens until you
  approve. Deny it and nothing runs.
- **Answer how-to questions** from these guides, with a link to the page it
  read.

It works inside the project you are looking at, and only there. It acts as
you: it can never do anything your rank in that project does not allow, and
it is not offered the tools your rank does not grant. Off a project page it
asks which project you mean.

What it writes is marked as written by an agent: a comment it posts shows your
name with the agent badge and the client `lore-ai`.

## What it sends, and what is kept

- Each message goes to the model with the page you are on (the project's id,
  name and language) and the results of the tools it runs, which can include a
  quest's description or a folio's body. On lore.alepha.dev the model runs on
  Cloudflare Workers AI.
- Conversations are stored in your Lore, visible to you only, and deleted 30
  days after their last message.
- Each user has a token budget (200,000 tokens per 24 hours by default) and a
  limit of 20 messages a minute. Past either, the assistant refuses until the
  window moves on.

## Turning it on

The assistant is off on every copy of Lore until an operator sets the
environment variable `AI_ASSISTANT_ENABLED` (any value other than empty,
`false` or `0`). It needs Cloudflare Workers AI: Lore on Workers declares the
`ai` binding, and a self-hosted copy off Workers refuses to start with the
variable set, since it has no model to talk to.

The budget, the rate and the retention are the `api.ai` parameter, which an
administrator edits at runtime from the admin console's parameters.
