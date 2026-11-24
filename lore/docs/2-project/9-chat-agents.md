# Chat agents

A chat agent is a named persona that a project's members mention in
[Chat](/lore/docs/project-chat), with a standing playbook. `@lore` answers
whatever you ask it; an agent already knows what its job is. Instead of
writing `@lore run the feedback triage, then look at the open errors, then...`
every morning, you write `@jarvis time to check`: Jarvis's playbook says what
checking means.

Every agent runs on the same engine as `@lore`, with the rights of the
member who mentions it, on the project's AI budget for agents when it has one
and on that member's own otherwise (see [The AI budget](#the-ai-budget)), and
asks for the same confirmation before every write. An agent changes what is asked and how it answers, never
what it may do.

## Creating an agent

Open **Settings ▸ Chat agents ▸ Agents**. The page lists `@lore`, the
built-in agent, then the project's own. Everyone who reads chat sees the
list; creating, editing and deleting agents needs the
**Chat agents** permission.

**New agent** asks for:

| Field                    | What it is                                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Handle**               | What a message mentions, `jarvis` for `@jarvis`: 2 to 32 lowercase letters, digits and dashes. It cannot be `lore`, another agent's, or a member's handle. |
| **Name**                 | How the room shows it: Jarvis.                                                                                                                             |
| **Avatar**               | An image of up to 2 MB. Without one, the agent's initials are drawn on a colour.                                                                           |
| **Model**                | The model it runs on. Empty uses your Lore's default model.                                                                                                |
| **Persona and playbook** | Markdown: who it is, what it does, how it answers.                                                                                                         |

A member who later picks an agent's handle as their own loses to the agent,
as with `@lore`.

## Writing a playbook

The playbook is added after Lore's own instructions, never instead of them,
so an agent keeps to this project, reads other people's messages as context
rather than orders, and still asks before writing anything. Say what the
agent does when it is mentioned, in the order it should do it, and how you
want the answer:

```markdown
You are Jarvis, the project's morning check.

When someone says "time to check":

1. List the feedback that came in since yesterday and triage it.
2. List the open errors, newest first, and say which look new.
3. Answer with three short sections: Feedback, Errors, Next.

Be brief. Never file a quest without saying why first.
```

⚠️ Every member who reads chat can read an agent's playbook. Keep secrets
out of it.

## Choosing a model

Leave **Model** empty to run on your Lore's default, or name a model your
provider serves: a cheap one for a routine check, a stronger one for a
reviewer. The model is free text and is only checked when the agent runs: a
name the provider refuses makes the agent's answer say so in the room.

The AI budget counts tokens whatever the model, so an agent on a stronger
model costs more than the budget shows.

## The AI budget

**AI budget for agents**, under the agent list, is what this project's agents
may spend: a number of tokens per window, the same window as every member's
own budget (24 hours by default). It shows what the agents spent over the
window, and when it is spent, when enough of it frees up.

A run draws on the project's budget while it has tokens left, and the member
who asked pays nothing for it. Once it is spent, a run falls back to that
member's own budget. When both are spent, the agent answers that it could not
run, naming each budget and when it frees up.

Leave the field empty for no project budget: every run is then the
member's. Setting it needs the **Chat agents** permission; every member who
reads chat sees what was spent.

## Talking to an agent

Type `@` in a room: the agents come first, each with its avatar. Mention one
and it answers in the room under its own name and avatar, with the trace of
the tools it runs and a card for every write, which only you, who asked, can
approve. One agent answers a message: the first one it mentions.

Each member has a conversation of their own with each agent in each room, so
`@jarvis` does not continue what you asked `@lore`, and the other way round.

When the assistant is off for your Lore, no agent answers, `@lore` included:
the settings page still lists and edits them, and says so.

## What an agent can read

An agent runs as the member who mentioned it, so it is offered only what that
member's rank reads in this project:

- **Plan and Remember**: quests, epics, releases, feedback, folios, the
  dashboards and search, and Lore's own guides.
- **How the apps run**, with the **Ship** capability on: uptime monitors, the
  errors inbox, Agent host jobs and their logs, deploys, and stacks. Monitors,
  deploys and stacks need **See the deployed copies**, errors **Read the crash
  inbox**, and jobs the permission to see the project's hosts.
- **Errors a member trusted, and only those.** Error text comes from the
  apps that report it, so an agent never reads a group nobody on the team has
  trusted on the Errors page; it is told how many wait.

It writes only through a card you approve: a quest, a comment, a folio, a
dashboard card or a feedback item. It never resolves an error, deploys or
rolls back.

To have an agent speak unasked, on a schedule or on project events, give it
rounds: an [agent automation](/lore/docs/agents-automations#a-chat-agents-rounds)
of kind **Chat agent's rounds**.

## Editing and deleting

The pencil on an agent's row edits it; a new name or avatar shows on its past
answers too. The bin deletes it after asking: its past answers keep showing
with its name and avatar, and its handle is free for another agent.

## Ranks

| Permission      | Lets a member                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------- |
| **Read chat**   | See the agents and read their playbooks.                                                          |
| **Write chat**  | Mention an agent in a message.                                                                    |
| **Chat agents** | Create, edit and delete the project's agents, and set their AI budget. Admins have it by default. |

See [Members](/lore/docs/project-members).

## From the command line

`lore chat agent list`, `lore chat agent get <handle>`,
`lore chat agent create`, `lore chat agent update <handle>` and
`lore chat agent delete <handle>` do what the page does. The playbook comes
from `--pre-prompt`: inline, `@playbook.md` for a file, or `@-` for stdin;
`--avatar <image>` uploads an avatar and `--no-avatar` removes it.

```bash
lore chat agent create --handle jarvis --name Jarvis --pre-prompt @jarvis.md --avatar jarvis.png
```

See the [CLI reference](/lore/docs/reference-cli).

## From an agent

Over MCP, `chat_agent_list`, `chat_agent_get`, `chat_agent_create`,
`chat_agent_update` and `chat_agent_delete` do the same, the avatar aside,
which only the command line uploads. A message sent with `chat_message_send`
that mentions an agent starts it, as from the page. See
[MCP tools](/lore/docs/reference-mcp-tools).
