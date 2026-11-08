# Dev MCP Server

`alepha mcp` is an MCP server for the coding agent working on your app. It
talks to the app `alepha dev` is running, through the
[inspector](/docs/guides-core-inspector), so the agent can read what the app
registers, follow its logs, read the emails it sent and the rows it wrote, and
call an action as a test user, instead of guessing from the source tree.

It is a development tool. To make your own app's features MCP tools, see
[MCP Server](/docs/guides-ai-mcp).

## Setup

`alepha init` registers it in the project's `.mcp.json`, run through the
project's package manager:

```json
{
  "mcpServers": {
    "alepha": { "command": "npx", "args": ["alepha", "mcp"] }
  }
}
```

An existing `.mcp.json` is merged, never overwritten: other servers are kept,
and an `alepha` entry already there is left as it is. Claude Code reads the
file on its own. For an agent that does not, `AGENTS.md` names the command,
and you can register `npx alepha mcp` (a stdio server) in its own MCP
settings.

Then run the app as usual, in a terminal of its own:

```bash
npx alepha dev
```

The agent starts `alepha mcp` itself; you never run it by hand. It never
starts an app either: when none runs, every tool says so and names
`alepha dev`.

## Which app

The server lists the apps from the inspector's run registry
(`~/.alepha/run`, or `ALEPHA_RUN_DIR`) and picks one:

1. the app chosen with `app_select`, if any;
2. else the running app whose folder (or git root) contains the folder the
   agent works in, the deepest one first;
3. else the only running app;
4. else, when nothing runs, the crashed run of this folder, whose logs stay
   readable.

A choice is kept by folder, not by run: `alepha dev` restarts the app under a
new run id on each reload, and the selection follows it.

## Tools

| tool                          | what it does                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `apps_list`                   | The running apps, and the last crashed run of each while its logs remain; marks the selected one.                                     |
| `app_select`                  | Choose the app by name, folder or run id.                                                                                             |
| `app_map`                     | What the app registers: actions, entities, pages, jobs, topics, modules, atoms, realms, roles, permissions, env. `section`, `filter`. |
| `app_describe`                | One item in full: an action's types, `$secure` rule and declared errors; an entity's columns; a page; a job.                          |
| `logs_mark`                   | A marker: the sequence number of the newest log entry.                                                                                |
| `logs_tail`                   | The latest entries, filtered by `level`, `logger`, `text`, `slowerThan` and `since` (a marker). `full` adds data and stacks.          |
| `emails_list`, `email_read`   | The emails the app captured in its local outbox, and one in full.                                                                     |
| `sms_list`, `sms_read`        | The same for SMS.                                                                                                                     |
| `action_call`                 | Call an action in the app as `"anonymous"`, `{ roles: [...] }` or an existing user (`{ id }`, `{ email }`).                           |
| `db_rows`                     | Rows of an entity: an equality `where`, `sort`, `size`, `page`. Read only.                                                            |
| `jobs_list`, `job_executions` | The jobs and their executions.                                                                                                        |
| `job_trigger`, `job_retry`    | Run a job now (with a payload), retry a failed execution.                                                                             |
| `docs_search`, `docs_read`    | The Alepha docs of the installed version, as `alepha docs` prints them. These work with no app running.                               |

The map comes from the same renderer as `alepha docs --app`: schemas written as
TypeScript-like types. On a large app the overview runs to tens of kilobytes,
so an agent passes `filter` (or a `section`) rather than reading it whole.

## A session

An agent asked to check that inviting a member sends the right email:

```text
apps_list                      -> * shop - live - cwd /work/shop - run k3x9q2mf
app_map { filter: "invite" }   -> POST /api/invitations `invitations.create` (secure)
app_describe { kind: "action", name: "invitations.create" }
                               -> body: { email: string; role: "member" | "admin" }
                                  secure: a signed-in user; roles admin
logs_mark                      -> Marker: 4182
action_call { action: "invitations.create",
              body: { email: "ada@example.com", role: "member" },
              as: { roles: ["admin"] } }
                               -> 200 in 41 ms
logs_tail { since: 4182 }      -> what that call logged, and nothing else
emails_list                    -> - ada@example.com,2026-...eml.json - "You are invited"
email_read { id: "..." }       -> the body, with the link to follow
```

Called with `as: "anonymous"`, the same action answers 401, as it would to a
signed-out visitor.

## What never reaches the agent

What the tools return goes into a model's context, and from there to its
vendor:

- **Environment values.** The map lists variable names, types and defaults,
  never values, and atoms by key and type, never values.
- **Secret columns.** `db_rows` replaces every column its entity marks
  `secret: true` with `"[redacted]"`, with no opt-out, and refuses a filter on
  one. The framework's own credential columns are marked; mark yours (see
  [Special Columns](/docs/guides-persistence-special-columns)).
- **Row writes.** No tool creates, updates or deletes a row.

`action_call` is the one tool that drives the app as any user, with no
authentication. The inspector refuses it whenever the app runs in production,
even a build made with `--inspect` and started with `ALEPHA_INSPECT=1`.
