# Folios

Folios are a project's memory: Markdown notes, filed in a tree, linked to each
other and to the work, and shared by every member and every agent of the
project. This page covers how to organise them, how links and revisions work,
encrypted folios, and how agents read and write them.

Folios need the **Write and keep knowledge** capability.

## Why folios

Quests record work; folios record what you know. A decision and its reasons, how
a subsystem fits together, a runbook, the conventions of the codebase: anything
the next person, or the next agent session, should not have to rediscover.

That second reader is the point. An agent starting a task on a Lore project
reads the folio index first, opens the folios that look relevant, and writes
down what it learned when it is done. Without that, every session starts from
nothing.

A few conventions keep folios useful:

- **One topic per folio.** The title is the topic.
- **Short and self-contained.** A folio that needs scrolling is two folios.
- **Always a summary.** One or two sentences on what the folio is for. It is
  the line the index shows, and what an agent reads to decide whether to open
  the folio at all. Say what kind of note it is in the first clause ("Decision:
  ...", "Runbook: ...").

## The workspace

**Folios** (`/<project>/folios`) is a three-pane workspace:

- the **tree** on the left, where you create, rename, move (by dragging) and
  delete folios and directories;
- the **document** in the middle: a folio with content opens rendered, an empty
  one opens for editing, **View ▸ Toggle preview** (`⌘E`) switches between the
  two, and edits save as you type;
- the **inspector** on the right, with the folio's **Outline**, **History**,
  **Links** and **Files**.

`⌘F` finds in the folio, and `⌘.` toggles focus mode.

The **Summary for agents** field is shown on a folio when the knowledge
capability's **Summaries for agents** option is on. Agents read and write it
over MCP either way.

## Directories

Folios live in a tree of directories, at most 8 levels deep. A folio and a
directory in the same parent cannot share a name; names are compared without
regard to case.

⚠️ **Deleting a directory deletes everything in it, folios included.** Move
what you want to keep out first. An agent's `directory_delete` refuses a
directory that is not empty unless it passes `cascade: true`.

## Links

Link to another folio, or to anything else in the project, with the typed
reference grammar:

| You write   | It links to       |
| ----------- | ----------------- |
| `[[#F12]]`  | folio 12          |
| `[[#Q12]]`  | quest 12          |
| `[[#E3]]`   | epic 3            |
| `[[#R12]]`  | release 12        |
| `[[#P120]]` | feedback item 120 |

The number is the per-project one shown beside each item. Nothing else between
`[[` and `]]` is a reference: a title, a path or an anchor renders as a broken
link.

Links are recomputed on every save. The **Links** tab shows both directions:
what this folio points to, and the folios, quests and epics that point to it.
The second half is the useful one: it surfaces context you did not know was
related.

## Pinned folios

Pin a folio and it sorts to the top of the list, and its content is handed to
every agent that orients itself on the project. Pinned folios are the project's
equivalent of a `CLAUDE.md` or `AGENTS.md`: the instructions every session
should read.

Pin sparingly. All pinned folios together share a budget of about 8,000
characters, spent every time an agent orients itself. The newest-updated come
first: the first one past the budget is cut there, the ones after it are left
out, and the agent is told so. Encrypted folios are never included.

## Epics

A design note that belongs to an [epic](/lore/docs/guides-epics) can be filed
under it. It then shows on the epic's **Folios** tab, and filtering the folio
list by that epic finds it.

## Attachments

A folio can carry files: images shown in its body, diagrams, PDFs. See
[Attachments](/lore/docs/guides-attachments).

## History

Every change is kept as a **revision**: created, edited, renamed or reverted, by
whom and when, with a snapshot of the title, summary and content.

Because folios save as you type, one writing session by one person is one
revision rather than one per keystroke: edits within an hour of the previous one
by the same author update that revision. A project keeps the 10 most recent
revisions of each folio by default; older ones drop off.

**Pinned revisions** survive that cap: pin a revision in the History tab to keep
exactly that snapshot.

Reverting never rewinds. It writes a new revision holding the old content, so
the state you reverted from stays in history and the revert can itself be
undone.

## Encrypted folios

A folio can be **encrypted** with a passphrase (**Encrypt…** in the folio's
menu). The content is encrypted in your browser: the server only ever stores
ciphertext, never the passphrase or the plain text. Share the passphrase with
whoever should read it some other way.

What that costs:

- ⚠️ **There is no recovery.** Forget the passphrase and the content is gone.
- The title and summary stay readable by every project member. Do not put the
  secret there.
- An encrypted folio is not searchable, its links are not tracked, and image
  uploads are disabled.
- An agent reading it over MCP gets the ciphertext, not the text.
- Turning encryption on, or off, **deletes the folio's revision history**,
  pinned revisions included. Otherwise the plain-text snapshots written before
  encryption would stay readable in History.

## From an agent

Agents reach folios through MCP:

| Tool                                                                                                  | What it does                                                                                  |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `project_context`                                                                                     | Orientation: the folio index (titles and summaries, no bodies) and the pinned folios, capped. |
| `folio_list`, `folio_search`                                                                          | The index, or a free-text search over title, summary and content.                             |
| `folio_get`                                                                                           | One folio's content, with its outbound and inbound links.                                     |
| `folio_create`, `folio_update`                                                                        | Write. `summary` should always be set; `epic_number` files it under an epic (0 detaches).     |
| `folio_history`, `folio_revert`                                                                       | Revisions, and rolling back to one.                                                           |
| `folio_delete`                                                                                        | Permanent.                                                                                    |
| `directory_list`, `directory_create`, `directory_rename`, `directory_move`, `directory_delete`        | The tree.                                                                                     |
| `folio_attachment_add`, `folio_attachment_list`, `folio_attachment_rename`, `folio_attachment_delete` | A folio's files.                                                                              |

A good habit to give your agent: orient with `project_context`, read what is
relevant with `folio_get`, and when a session produced a decision that was not
obvious, write a folio about it before finishing.

## From the command line

```bash
lore folio list
lore folio list --epic E45
lore folio get F12
lore folio create --title "Decision: one database per tenant" \
  --summary "Decision: why each tenant gets its own database, and what it costs." \
  --content @decision.md
```

`--content @file` reads the body from a file, `@-` from standard input. See
[The lore CLI](/lore/docs/guides-cli#folios).
