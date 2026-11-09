# Agent prompts

Every surface that names a piece of work can hand it to a coding agent. An
**Agent Prompts** menu appears on epics, quests and feedback, and on the
Quests page, the feedback inbox and the blights inbox, and a click
copies a ready prompt for Claude Code, Codex or anything else that reads a
paste.

**It starts off.** The switch is **Settings ▸ Quests ▸ Features ▸ Agent prompts**, one
click, once, per project. Until you turn it on the menus are not there, and
that is deliberate: a project that does not hand work to agents should not
carry a menu that does.

Nothing is ever sent anywhere. The prompt is rendered in your browser and
put on your clipboard, and Lore neither transmits it nor keeps a copy of
what you pasted.

## The prompts

| Prompt                      | Where                                                              | Offered when                                                                         |
| --------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| **Review**                  | an epic's row menu, and the epic page                              | nobody has started the epic: it is `draft` or `ready`                                |
| **Work on it** (epic)       | the same two places                                                | the epic is `ready` or `in_progress`, or `draft` when you may mark it ready          |
| **Work on it** (quest)      | a quest's row menu, the epic's own quest table, and the quest page | the quest is not completed, and its epic, if it has one, is `ready` or `in_progress` |
| **Work on it**              | the feedback detail panel                                          | the report is `pending` or `accepted`, and Support is on                             |
| **Triage the inbox**        | the feedback detail panel                                          | Support is on                                                                        |
| **Triage the blights**      | the blights inbox toolbar                                          | Apps is on                                                                           |
| **Work the loose quests**   | the Quests page toolbar                                            | always, with Work on                                                                 |
| **Write the weekly status** | the Reports Summary tab                                            | always, with Work on                                                                 |

**Review** asks an agent to sharpen a plan before anyone works it: take the
decisions the spec left open, tighten the vague quests, and say plainly what
it cannot answer alone. It files what it found as one review on the epic,
with numbered questions, decisions and changes, and lists the questions in
its reply by those numbers, so you can answer on the epic's Review tab or in
the chat ("answer 3: B"). It reads the earlier reviews' decision log first,
and does not ask again what is already answered. See
[Reviewing an epic](/lore/docs/guides-epics#reviewing-an-epic).

**Work on it** on an epic hands the whole epic over, quest by quest: accept,
work, verify, commit and complete each quest in turn. It sets no status. The
first quest the agent accepts is what moves a ready epic to in progress, and
the last one it closes is what completes it. It treats the epic's
decision log as settled, and stops on a review question still open rather
than answering it for you. On a draft epic, whose quests refuse to be
accepted, it is offered only if you may mark the epic ready, and clicking
it does both: it copies the prompt and marks the epic ready, so handing a
finished spec over is one click. The list shows the same Undo as its own
Mark as ready. Whether the spec is done stays your call, never the agent's.
Copying it from a ready or started epic changes nothing about the epic.

**Work on it** on a quest is the narrow version: one quest, one branch, one
commit, and anything discovered beyond it is a comment rather than extra
scope.

**Work on it** on a feedback item starts before there is a quest: it accepts
the report, creates the quest linked to it, does the work, and ends by
telling the reporter what shipped.

The last four name a **surface** rather than one item, so they carry no
`{{number}}`, `{{id}}`, `{{reference}}` or `{{title}}`: there is nothing to
number. All but the status are loops that re-read their list every round,
because they change the list they read. **Triage the inbox** accepts, rejects or asks
about every pending report until none is left, and **Triage the blights**
files a quest for each real defect and resolves the noise.

**Work the loose quests** hands over every quest in `todo` that belongs to
no epic, one at a time, under the same rules as an epic's **Work on it**:
one worktree and one branch for the run, each quest accepted before its
first commit and named in every commit, completed when it lands, and one
merge at the end once CI is green. It reads the list again after each quest,
so a quest filed during the run is picked up rather than missed.

**Write the weekly status** changes nothing: the agent reads the week through
`project_report`, opens the section behind each figure that moved, and answers
with what shipped, what moved and what needs a decision. See
[Reports](/lore/docs/guides-reports).

## Writing your own

Each prompt has a built-in default, and Settings ▸ Quests ▸ Agent prompts is where you replace
it. **Reset to default** deletes your version rather than copying today's
text into the box, so a prompt you have reset keeps following the built-in
one as it improves.

The templates are written in English on purpose. Their words are the names
of the tools an agent calls, so translating them would break them. The
labels and toasts around them are localized; the payload is not.

### The seven placeholders

| Placeholder     | What it renders                                      |
| --------------- | ---------------------------------------------------- |
| `{{project}}`   | the project's **title**                              |
| `{{slug}}`      | the project's URL **slug**                           |
| `{{number}}`    | the number you recognise: `41` for epic `#E41`       |
| `{{id}}`        | the global id, which a quest list filters an epic by |
| `{{reference}}` | the typed reference: `#E41`, `#Q1798`, `#P2087`      |
| `{{title}}`     | the subject's own title                              |
| `{{url}}`       | a link to it                                         |

**`{{project}}` and `{{slug}}` are not interchangeable**, and this is the
one thing worth getting right. An MCP call's `project_name` matches the
project's **title**, never its slug. A project titled `Kanban v2` has the
slug `kanban-v2`, and a prompt that hands the slug to `project_name` answers
"not found". Use `{{project}}` wherever you name the project to a tool, and
`{{slug}}` only where you are building a URL by hand.

A placeholder Lore does not know is left in the text exactly as you wrote
it, so a typo shows up in what you paste rather than blanking a line. And a
placeholder that happens to appear inside a _value_ is never expanded: a
quest titled `Fix {{url}} handling` keeps its own title.

### A worked example

Every project's verify commands and branch rules are different, and that is
the edit worth making. An epic **Work on it** template for a project that
verifies with one command and does not let an agent merge:

```
Work epic {{reference}} "{{title}}" of the Lore project "{{project}}" to
completion, quest by quest.

The epic: {{url}}

Read it with `epic_get` (project_name "{{project}}", number {{number}}) and
its quests with `quest_list` (`epic: {{id}}`, `detail: "full"`).

Work in a git worktree, on a branch named after the epic. Never on main.

For each quest: `quest_accept`, do the work, tick each objective with
`quest_objective_set`, then run `make verify` and fix everything red before
moving on. One commit per quest. `quest_complete` with a short note.

When every quest is done, run `make verify` once more on the whole branch,
push the branch, and open a pull request. Do NOT merge to main: this project
merges by review. Then file an outcome folio under the epic with
`folio_create` and `epic_number` {{number}}.
```

That is the shape most edits take: the same skeleton, with the project's own
commands in it and its own rule about who is allowed to merge.

## Who can change them

Reading the templates is open to any project member; changing one is the
project owner's. The prompts are stored per project, not per member: one
project, one set.
