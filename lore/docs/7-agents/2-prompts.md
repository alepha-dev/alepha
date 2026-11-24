# Agent prompts

An agent prompt is a ready-made instruction for a coding agent: "review this
epic", "work on this quest", "triage the inbox". Lore offers one wherever a
piece of work is named, and a click copies it to your clipboard, for you to
paste into your agent or anything else that reads a paste.

Nothing is sent anywhere. The prompt is put together in your browser and copied.
Lore does not transmit it and keeps no copy of what you pasted.

**It starts off.** Turn on the **Prompts** option in **Settings ▸ Plan
▸ Quests**, once per project. Until then the menus are not shown. See
[Capabilities](/lore/docs/project-capabilities).

## Copying a prompt

With the option on, an **Agent Prompts** menu appears in two forms: a robot
button on a page (an epic, a quest, a feedback item, the Quests page, the
errors inbox, the Reports summary), and an **Agent Prompts** entry in the row
menu of the epic and quest lists.

Pick an entry. Lore confirms that the prompt was copied, and you paste it into
your coding agent. The agent needs access to the project to act on it: see
[Connecting an agent](/lore/docs/agents-connecting).

## The prompts

| Prompt                         | Where                                                              | Offered when                                                                     |
| ------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| **Review Epic**                | an epic's row menu, and the epic page                              | nobody has started the epic: it is a draft or ready                              |
| **Work on it** (epic)          | the same two places                                                | the epic is ready or in progress, or a draft that you may mark ready             |
| **Work on it** (quest)         | a quest's row menu, the epic's own quest table, and the quest page | the quest is not completed, and its epic, if it has one, is ready or in progress |
| **Work on it** (feedback)      | the feedback detail panel                                          | the report is pending or accepted                                                |
| **Triage feedback and errors** | the feedback detail panel, and the errors inbox toolbar            | always, with Plan's **Feedback** option on (feedback) or **Ship** on (errors)    |
| **Work the loose quests**      | the Quests page toolbar                                            | always                                                                           |
| **Write the weekly status**    | the Reports **Summary** tab                                        | always                                                                           |

Three more run on an [Agent host](/lore/docs/agents-jobs) rather than being
copied: **Review a pull request** (under a quest's pull requests),
**Security check** and **Dependency update** (from the command line, or as an
automation). You edit their text here like the others.

### On an epic

**Review Epic** asks an agent to sharpen a plan before anyone works it: take
the decisions the spec left open, tighten the vague quests, and say plainly
what it cannot answer alone. It files what it found as one review on the epic,
with numbered questions, decisions and changes, and lists the questions in its
reply by those numbers, so you can answer on the epic's Review tab or in the
chat ("answer 3: B"). It reads the earlier reviews' decisions first, and does
not ask again what is already answered. See
[Reviewing an epic](/lore/docs/plan-epics#reviewing-an-epic).

**Work on it** hands the whole epic over, quest by quest: accept, work, verify,
commit and complete each quest in turn, all in one pull request. It treats the
epic's decisions as settled, and stops on a review question still open instead
of answering it for you.

The prompt sets no status itself. The first quest the agent accepts is what
moves a ready epic to in progress, and the last one it closes is what completes
it. A draft epic is the exception, because its quests refuse to be accepted:
there the entry is offered only if you may mark the epic ready, and clicking it
does both. It copies the prompt and marks the epic ready, so handing a finished
spec over is one click. Whether
the spec is done stays your call, never the agent's. Copying the prompt from a
ready or started epic changes nothing about the epic.

### On a quest or a feedback item

**Work on it** on a quest is the narrow version: one quest, one branch, one
pull request, one commit, and anything discovered beyond it is a comment, not
extra scope.

**Work on it** on a feedback item starts before there is a quest: it accepts
the report, creates the quest linked to it, does the work, and ends by telling
the reporter what shipped.

### On a whole page

The last three are about a page, not one item. Two of them are loops that
read their list again every round, because they change the list they read.

**Triage feedback and errors** accepts, rejects or asks about every pending
report, and, when the project tracks errors, files a quest for each real
defect among the trusted errors (or adds it to the quest of the report it
explains) and resolves the noise, until nothing is left. It is the same
prompt from the feedback inbox and from the errors inbox.

**Work the loose quests** hands over every to-do quest that belongs to no epic,
one at a time, under the same rules as an epic's **Work on it**: one branch and
one pull request for the whole run, one commit per quest, each quest accepted
before its commit and named in it. A quest filed during the run is picked up,
not missed.

**Write the weekly status** changes nothing: the agent reads the week's report,
opens the section behind each figure that moved, and answers with what shipped,
what moved and what needs a decision. See
[Reports](/lore/docs/project-reports).

### On an Agent host

**Review a pull request** reads the diff against its base, the quest the pull
request is recorded on and the repository's agent instructions, posts its
review with `gh pr review`, and sums it up on the quest. The host first checks
that the pull request's author can write to the repository, unless a member
trusts the author.

**Security check** runs each package manager's own audit on the lockfiles,
keeps what the code really reaches, and files one quest per real
vulnerability, or comments on the open quest that covers it. With nothing real,
it files nothing.

**Dependency update** updates the packages its run names, or the ones a minor
or patch version behind, runs the project's checks, and opens a pull request
only when they pass, naming what changed and what it left behind.

### How the work lands

Every prompt that changes code lands it through a pull request, and how many
quests one pull request holds depends on how the work was handed over:

| Handed over as            | Pull requests          |
| ------------------------- | ---------------------- |
| an epic's **Work on it**  | one for the whole epic |
| **Work the loose quests** | one for the whole run  |
| any other **Work on it**  | one per quest          |

Whatever the shape, one quest is one commit, and the pull request is merged by
rebase, so main receives every quest's commit as it is and a bad quest can be
reverted alone. The flow:

1. A branch cut from the latest main, in a git worktree of the agent's own.
   Never on main.
2. For each quest, the project's local checks, then one commit that names it.
   A later fix to a quest goes into that quest's commit, never into the next
   one's.
3. A pull request into main, its description linking the quests, and the pull
   request recorded in Lore: once on the epic for an epic, on each quest
   otherwise, so it shows in each quest's side rail. An epic or a run opens it
   as a draft after its first quest and pushes after every quest, so CI runs
   while the next quest is worked.
4. CI on the pull request is the gate, when the project has CI. A green local
   check is not.
5. The agent never merges it, never pushes to main, and never merges main into
   its branch: it rebases instead. If the project's `AGENTS.md` (or
   `CLAUDE.md`) lets an agent turn on auto-merge, it does, as a rebase merge.
   Otherwise the pull request waits for your review.
6. Every quest completes once its commit is pushed, in the same run, without
   waiting for CI or the merge: the merge often lands after the agent has
   stopped, and nothing would bring it back to close the quest. In an epic or
   a run, the quests that depend on it can then start, and the epic's last
   quest completes the epic. A completed quest says the work is done, not
   that it has shipped: the quest shows where it is live once a deployment
   carries its commit. If the agent is still there after the merge, it records
   on every quest the commit main received.

An agent never stops with a quest it accepted still open, unless it stopped
on a question for you. A pull request still waiting for review when it stops
is named in its reply, with its link.

## Writing your own

Each prompt has a built-in default. **Settings ▸ Plan ▸ Prompts** is
where you replace it: a legend of the placeholders, then one editor per prompt,
each with **Save** and **Reset to default**.

![The agent prompts settings page, with one editor per prompt](/screenshots/lore/agent-prompts-light.png)

**Reset to default** discards your version instead of copying today's text into
the box, so a prompt you have reset keeps following the built-in one as it
improves.

The prompts are written in English on purpose. Their words are the names of the
tools an agent calls, so translating them would break them. The menus and
messages around them follow your language; the text that is copied does not.

Every project's verify commands and branch rules are different, and that is the
edit worth making.

### Placeholders

| Placeholder     | What it renders                                      |
| --------------- | ---------------------------------------------------- |
| `{{project}}`   | the project's **title**                              |
| `{{slug}}`      | the project's URL **slug**                           |
| `{{number}}`    | the number you recognise: `41` for epic `#E41`       |
| `{{id}}`        | the global id, which a quest list filters an epic by |
| `{{reference}}` | the typed reference: `#E41`, `#Q1798`, `#P2087`      |
| `{{title}}`     | the subject's own title                              |
| `{{url}}`       | a link to it                                         |

⚠️ **`{{project}}` and `{{slug}}` are not interchangeable.** An agent's tools
find the project by its **title** (`project_name`), never by its slug. A
project titled `Kanban v2` has the slug `kanban-v2`, and a prompt that hands
the slug to `project_name` is answered "not found". Use `{{project}}` wherever
you name the project to a tool, and `{{slug}}` only where you build a URL by
hand.

The four prompts about a whole page have no item to name, so `{{number}}`,
`{{id}}`, `{{reference}}` and `{{title}}` are not filled in there.

A placeholder Lore does not know is left in the text exactly as you wrote it,
so a typo shows up in what you paste instead of blanking a line. A placeholder
that happens to appear inside a value is never expanded: a quest titled
`Fix {{url}} handling` keeps its own title.

### A worked example

An epic **Work on it** prompt for a project that verifies with one command and
reviews every quest on its own, one pull request per quest, rather than the
whole epic at once:

```
Work epic {{reference}} "{{title}}" of the Lore project "{{project}}" to
completion, quest by quest.

The epic: {{url}}

Read it with `epic_get` (project_name "{{project}}", number {{number}}) and
its quests with `quest_list` (`epic: {{id}}`, `detail: "full"`).

Work in a git worktree. Never on main.

For each quest: cut a branch from the latest main, `quest_accept`, do the
work, tick each objective with `quest_objective_set`, then run `make verify`
and fix everything red. One commit, naming the quest. Push the branch and open
a pull request into main for that quest alone. Do NOT merge it: a reviewer
merges each one. Start the next quest only once it has merged, and complete
each quest with `quest_complete` once its pull request has merged.

When the last one has merged, file an outcome folio under the epic with
`folio_create` and `epic_number` {{number}}.
```

That is the shape most edits take: the same skeleton, with the project's own
commands in it and its own rule about how a change lands and who merges it.

## Who can change them

Any member of the project can read the prompts. Changing one needs the
`project:update` permission, which the owner holds. See
[Members](/lore/docs/project-members).

The prompts are stored per project, not per member: one project, one set.

## Next

- [Connecting an agent](/lore/docs/agents-connecting): what an agent needs
  before a pasted prompt can do anything.
- [Epics](/lore/docs/plan-epics): drafts, reviews and marking an epic ready.
- [Assistant](/lore/docs/agents-assistant): the chat inside Lore.
- [MCP tools](/lore/docs/reference-mcp-tools): the tools the prompts name.
