# Prompts

A prompt is a ready-made instruction for a coding agent: "review this epic",
"work on this quest", "triage the inbox". You can **copy** it, filled in for
the item you picked, and paste it into your agent. When the project has an
[Agent host](/lore/docs/agents-jobs), you can also **run** it there: Lore
starts the agent on the host and you read what it did on the job's page.

## Turning Prompts on

Prompts is a capability, **off** in a new project. Turn it on in **Settings ▸
General ▸ Capabilities**, under **General**, or tick it when you create the
project.

Prompts is what runs every agent in a project. While it is off, no agent runs
there: no prompt, no trigger, no pin on a page, and none of the agent work the
other pages offer either, such as working a quest, reviewing an epic's plan
or triaging the feedback inbox. Its pages, its commands and its tools answer
that the project does not have Prompts.

Turning it off **deletes nothing**: your prompts, their triggers and pins, and
every job and its log stay, and turning it back on finds them where you left
them. A job already running when you turn it off finishes, but tells nobody
that it ended. A trigger that falls due while it is off does not run later: it
waits for its next time.

## Where prompts live

Every prompt lives in **Settings ▸ Prompts**, in two tabs:

- **Prompts**: every prompt of the project, built-in or your own, what it
  takes, where its code comes from, when it runs on its own, and its last run;
- **Jobs**: every run, newest first, filtered by prompt, status and host.

![Settings, Prompts: the built-in prompts, their args, source and trigger](/screenshots/lore/prompts-light.png)

Every member can read and copy a prompt. Changing one, setting its trigger
and pinning it needs **Manage the project's prompts**, which the Admin rank
holds. Running one needs to see the project's hosts, and the permission the
prompt itself asks for (working a quest needs to update quests).

## The built-in prompts

| Prompt                         | Takes                                | Code       | What it does                                                                  |
| ------------------------------ | ------------------------------------ | ---------- | ----------------------------------------------------------------------------- |
| **Review Epic**                | an epic, draft or ready              | read-only  | sharpens a plan before anyone works it, and files one review on the epic      |
| **Work on epic**               | an epic, ready or in progress        | read-write | works the epic quest by quest, in one pull request                            |
| **Work on quest**              | a quest, to do or in progress        | read-write | one quest, one branch, one pull request, one commit                           |
| **Work on feedback**           | a feedback item, pending or accepted | read-write | accepts the report, files the quest, does the work, tells the reporter        |
| **Triage feedback and errors** | nothing                              | read-only  | accepts, rejects or asks about every pending report, and files real defects   |
| **Work on loose quests**       | nothing                              | read-write | every to-do quest in no epic, one at a time, in one pull request              |
| **Weekly status**              | a member (you, unless you pick one)  | none       | reads the week's report and answers with what shipped, moved and needs you    |
| **Review PR**                  | a pull request                       | read-only  | reviews the diff with `gh pr review`, and sums it up on the quest             |
| **Security check**             | nothing                              | read-only  | runs each package manager's audit, and files one quest per real vulnerability |
| **Dependency update**          | nothing                              | read-write | updates what is a minor or a patch behind, and opens a pull request if green  |

A prompt that works a quest, an epic or a feedback item never leaves the quest
half done: it completes it, or, when it stops on a question for you, it says
why in a comment and tags the quest **`needs-answer`**.

A built-in's words cannot be edited. Lore improves them over time, and a
project that keeps its own copy would stop following. To change the words,
duplicate the prompt and edit the copy.

The prompts are written in English on purpose: their words are the names of
the tools an agent calls. The menus around them follow your language.

## Copying a prompt

**Copy**, in a prompt's row, asks one question per arg it takes, each a list
of the items it accepts (the epics that are draft or ready for **Review
Epic**), then puts the text on your clipboard. A prompt that takes nothing,
or only a member, copies at once.

Paste it into your agent. The agent needs access to the project to act on it:
see [Connecting an agent](/lore/docs/agents-connecting).

A copy reads each item with your own permissions, and a prompt never reads
text written outside the team that no member trusted: a report from outside
is named, never quoted, until a member trusts it.

## Pinning a prompt to a page

A prompt shows on a page only where the project pinned it. **Pin**, in a
prompt's row, lists the pages it can go on, and **Pinned on** shows where it
is:

| Page          | Fills                  |
| ------------- | ---------------------- |
| Quest list    | nothing                |
| Quest view    | the quest              |
| Epic list     | nothing                |
| Epic view     | the epic               |
| Feedback list | nothing                |
| Feedback view | the open feedback item |
| Error list    | nothing                |

A page with something pinned shows a robot button: each pinned prompt opens on
**Copy** and, with an Agent host ready, **Run**. On a view, the page's item
fills the prompt's arg of that type, so **Work on quest** pinned on the Quest
view copies in one click. A prompt whose arg does not accept the item's status
is not offered on it: **Work on quest** does not show on a completed quest.
A row of a list offers, in its menu, what is pinned on its item's view, the
row's item filled in. A new project pins nothing, so no robot button shows
until someone pins.

Every prompt, pinned or not, is also in the search palette (⌘K): type "Copy
prompt" or "Run prompt" and its title. On a view, the page's item is filled in
there too.

## Running a prompt

**Run** is offered when the project has an Agent host that is ready. It asks
the args, then the host when there are several, and nothing else: the code
the run finds is the prompt's own setting, and the run takes the first agent
CLI the host reports, with its default model.

The run opens its job's page, where its progress shows. The agent's final
reply is the first thing on it, once the job ends. See
[Agent jobs](/lore/docs/agents-jobs).

A prompt that takes a **member** emails its final reply to that member when
the run succeeds: **Weekly status** run every Monday lands in your mailbox.
The member is you unless you pick another.

### The code a run finds

Each prompt says where its code comes from, set on the prompt, never at a run:

- **No repository**: the run works from Lore alone.
- **Read-only**: the repository at its default branch (or the branch, tag or
  commit the prompt names), already checked out, never cloned by the agent.
- **Read-write**: a worktree on a branch Lore names, from which the agent
  pushes and opens its pull request.

A built-in comes with its own; you may change it on the prompt (**Source**
in its row). Your own prompts set it in their editor.

## Writing your own

**New prompt** opens the editor: a name, a title, a description, up to four
args, the source and the words. **Duplicate** starts from any prompt, a
built-in included; the copy no longer follows the built-in.

An arg has a name, a type (epic, quest, feedback item, pull request or
member) and, for the first three, the statuses it accepts. The words read it
through placeholders, which the editor lists:

| Placeholder           | What it renders                                        |
| --------------------- | ------------------------------------------------------ |
| `{{project}}`         | the project's **title**                                |
| `{{slug}}`            | the project's URL **slug**                             |
| `{{projectUrl}}`      | a link to the project                                  |
| `{{quest.reference}}` | an arg's reference, `#Q12` (and `.title`, `.url`, ...) |

⚠️ **`{{project}}` and `{{slug}}` are not interchangeable.** An agent's tools
find the project by its **title**, never by its slug. Use `{{project}}`
wherever you name the project to a tool, and `{{slug}}` only where you build a
URL by hand.

A placeholder Lore does not know is left as you wrote it, so a typo shows in
what you paste.

## Triggers: runs that start on their own

**Trigger**, in a prompt's row, runs it without anyone clicking:

- **On project events** (`event:<key>`), the events of **Settings ▸
  Notifications**: `quest.created`, `feedback.created`, `epic.ready`,
  `pull_request.added` and the others. An event about a quest fills the
  prompt's quest arg, one about a feedback item its feedback arg, one about an
  epic its epic arg, one about a pull request its pull request arg: one run
  per item. A prompt that takes nothing gathers the events that arrive
  together into one run, after a short wait (60 seconds by default).
- **On a schedule**: `hourly`, `6h` (00:00, 06:00, 12:00 and 18:00 UTC),
  `daily@<hour>` or `weekly@<day>@<hour>`, hours in UTC. A schedule fills no
  arg, so each arg gets a stored value: the member **Weekly status** mails,
  the epic a nightly **Work on epic** works.
- **Both**, joined by a comma: `event:feedback.created,hourly`.

**Only when there is something to do** checks first, so an idle project
spends nothing: pending feedback, errors, loose quests or epics to work.

A triggered run is its owner's, the member who set the trigger last, whoever
caused the event. It skips, saying why in the **Last run** column, an item its
arg does not accept, a quest tagged **`needs-human`**, and the events its own
jobs raised: a run's work starts at most one more run, never a loop.

### When something goes wrong

A triggered prompt runs unattended, so it stops by itself:

- **Ceilings**: 6 runs an hour and 48 a day by default, set on the trigger. A
  run past one is skipped, and the event **Prompt ceiling reached** says so
  once.
- **Three failed runs in a row** turn the trigger off, and the event **Prompt
  disabled** says why. A successful run resets the count. A trigger that is
  off says **off** in the **Trigger** column; **Enable trigger** in the row's
  menu turns it back on, and **Disable trigger** turns one off by hand.
- **A host that cannot take a run** skips it without counting a failure.
- **Pause all triggers**, above the table, stops every trigger of the project
  until **Resume triggers**. A run by hand still works.

To hear about a run that ended, subscribe to **Agent job succeeded** or
**Agent job failed** in **Settings ▸ Notifications**. Nobody is told without
a subscription, not even for a run you started by hand.

## How the work lands

Every prompt that changes code lands it through a pull request, and how many
quests one pull request holds depends on how the work was handed over:

| Handed over as           | Pull requests          |
| ------------------------ | ---------------------- |
| **Work on epic**         | one for the whole epic |
| **Work on loose quests** | one for the whole run  |
| any other work prompt    | one per quest          |

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
5. Before the pull request may merge, a reviewer sub-agent reads it cold: the
   diff, the quests and their objectives, and the repository's `AGENTS.md`
   (or `CLAUDE.md`), never the author's reasoning. The agent fixes what holds
   in the quest's own commit, runs the checks again and pushes, and its reply
   says what the review found and fixed.
6. The agent never merges it, never pushes to main, and never merges main into
   its branch: it rebases instead. If the project's `AGENTS.md` (or
   `CLAUDE.md`) lets an agent turn on auto-merge, it does, as a rebase merge.
   Otherwise the pull request waits for your review. A quest the agent left
   with a comment, or tagged `needs-answer`, does not hold back a run's or an
   epic's pull request: it stays open, and the rest goes ready.
7. Every quest completes once its commit is pushed, in the same run, without
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

## From the command line

```bash
lore prompt list
```

```bash
lore prompt render work-quest --quest Q12
```

```bash
lore prompt run triage --wait
```

```bash
lore prompt trigger weekly-status --on weekly@mon@7 --set member=<your id>
```

```bash
lore prompt pin work-quest --on quest
```

`lore prompt create`, `update`, `duplicate` and `delete` manage your own
prompts; `enable`, `disable`, `pause-all` and `resume-all` the triggers. The
full list is in the [CLI reference](/lore/docs/reference-cli). Every `lore
prompt` command needs Prompts on in the project.

## From an agent

`prompt_list`, `prompt_get`, `prompt_create`, `prompt_update` (its words, its
source, its trigger and its pins in one call), `prompt_duplicate`,
`prompt_delete`, `prompt_render`, `prompt_run`, `prompt_pause_all` and
`prompt_resume_all` are the twins of `lore prompt`. Called with an agent job's
own key, every write and `prompt_run` are refused: a job never starts a job.
With Prompts off in the project, every one of them is refused, with a message
that names the capability.

## Next

- [Agent jobs](/lore/docs/agents-jobs): the hosts a prompt runs on, and a
  job's page.
- [Connecting an agent](/lore/docs/agents-connecting): what an agent needs
  before a pasted prompt can do anything.
- [Epics](/lore/docs/plan-epics): drafts, reviews and marking an epic ready.
- [MCP tools](/lore/docs/reference-mcp-tools): the tools the prompts name.
