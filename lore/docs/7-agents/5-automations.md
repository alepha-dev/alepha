# Agent automations

An agent automation runs a prompt on one of your Agent hosts for you: once
when you ask, at each new feedback item, or every hour if there is something
to do. It is how a project triages its feedback and errors on your own agent
subscription, then turns the quests the triage filed into pull requests,
without anyone pasting a prompt.

An automation is one row, and nothing more:

- a **name**, unique in the project, and its **owner**, the member who created
  it: every job it starts runs with the owner's permissions;
- a **prompt**: Triage (the project's Triage prompt over the inbox and the open
  errors), Build (the project's Build prompt on a quest), your own text, or a
  chat agent's rounds (see [A chat agent's rounds](#a-chat-agents-rounds));
- **where it runs**: the Agent host, the agent CLI and its model, each left out
  when the project has only one;
- **when it runs**: by hand, on project events, or on a schedule;
- an optional **only if there is something** check;
- a switch to turn it on or off.

There are no steps, branches or conditions: an automation starts agent jobs,
and each run is a job with its own page and log under **Jobs**.

## The page

**Settings ▸ General ▸ Automations** lists the project's automations: the
prompt, when it runs, its host and agent, its last run with that job's status
(a link to the job), its next run or why its trigger last started nothing, and
a switch. **Run now**, in a row's menu, runs it once as you. **New automation**
opens a small form with the same fields as the command line.

Reading the page needs the permission to see the project's hosts; creating,
changing and running automations needs **Create, change, delete and run the
project's agent automations**, which the Admin rank holds.

## When it runs

- **By hand** (`manual`): only **Run now**, `lore automation run`, or
  `automation_run`.
- **On project events** (`event:<key>`): the events of **Settings ▸
  Notifications**, by their key, such as `feedback.created`, `feedback.trusted`
  (a member trusted a report written outside the team) or `quest.created`.
  Events that arrive together are gathered: the first one starts a short wait
  (60 seconds by default), and everything that arrives meanwhile lands in the
  same run. An event that arrives while the automation's job runs starts one
  more run when that job ends. What an automation's own jobs write never starts
  it again.
- **On a schedule**: `hourly`, `6h` (00:00, 06:00, 12:00 and 18:00 UTC) or
  `daily@<hour>`, an hour in UTC. A run missed while a host was down is not
  replayed: the next one decides again.

A run its trigger starts is the owner's, whoever caused the event.

## Only if there is something

With **Only if there is something to do**, Lore checks before it asks the host
for anything, so an idle project spends no tokens:

- a Triage runs when a pending feedback item an agent may read waits (written
  by the team, or trusted by a member), or a trusted open error group (one
  a member trusted, or a server error), when the project tracks errors;
- a Build runs when a quest its rule would pick exists.

A text prompt has no such check, nor has a chat agent's rounds. When a run is
skipped, the row says why.

## A chat agent's rounds

A chat agent only answers when it is mentioned. A **Chat agent's rounds**
automation runs one of the project's [chat agents](/lore/docs/project-chat-agents)
in a room on its trigger, as if you, its owner, had mentioned it there with
the words you gave it: "do the morning rounds" every day at 7, for an agent
whose playbook says what to inspect.

- It runs in Lore, with the agent's own model, not on an Agent host: it needs
  no host, and names none.
- It acts as you, with your rank, and draws on the project's AI budget for
  agents first, then on yours.
- When the agent finds nothing worth telling the room, it says so and nothing
  is posted: a clean house stays quiet. Its answer is posted once, when the run
  ends.
- A room that no longer exists, or a private room you are not in, skips the
  run, and the row says why.

## Building quests into pull requests

A Build automation, usually on `event:quest.created`, picks every quest that is
all of:

- not accepted, completed or set aside, assigned to nobody, not on hold, with
  no unfinished dependency, and not in a draft epic;
- not tagged **`needs-human`**;
- not born of feedback written outside the team, unless a member confirmed its
  text;
- never built by this automation before, whatever that build's outcome: a
  failed build is retried by hand.

Each quest gets one job in its own workspace: the agent accepts the quest,
branches, does the work, runs the checks, commits naming the quest, pushes,
opens a pull request with `gh` and records it on the quest. With **Ask for
auto-merge**, it turns auto-merge on; the repository's own protections decide
the rest. **Builds at once** runs several quests side by side, one per job,
up to what the host itself allows.

The default Triage prompt tags `needs-human` any quest it is not sure of, that
touches security, migrations or money, or that came from a report it could not
reproduce. A project that edited its Triage prompt adds that sentence itself.

A built quest completes when a commit naming it reaches the default branch.
Lore learns it from the commit push your CI makes on that branch: `lore
artifacts push` for a project that deploys through Lore, otherwise one line in
the workflow of the default branch:

```yaml
- run: npx @alepha/lore commits push --project acme
```

The quest completes with a message naming the commit and its pull request,
and its workspace is removed from the hosts that ran it. A quest worked by
hand is never completed this way.

A build may follow a triage: the quest a triage job filed starts the Build
automation once. A build's own work starts nothing.

## When something goes wrong

An automation runs unattended, on your subscription and with your `gh`
sign-in, so it stops by itself:

- **Ceilings**: at most 6 runs an hour and 48 a day for each automation, and
  20 builds a day for the project. A run past a ceiling is skipped and says so.
- **Three failures in a row** turn the automation off. A successful run resets
  the count. An agent that keeps hitting its usage limit fails its jobs, so
  this stops it too.
- **A host that cannot take a run** (offline, failing its check, or no longer
  reporting the agent the automation names) skips the run without counting a
  failure.
- **Pause all**: `lore automation pause-all` stops every trigger of the
  project until `lore automation resume-all`. A run by hand still works.

Three events let you hear about it in **Settings ▸ Notifications**:
**Automation disabled** (with its last job and why), **Automation run failed**
and **Automation ceiling reached**.

None of these limits applies to a run by hand.

## An example

Triage each new feedback item, and build what it files that needs no human:

```bash
lore automation create triage --prompt triage --on event:feedback.created,feedback.trusted --only-if-work
```

```bash
lore automation create build --prompt build --on event:quest.created --auto-merge --concurrency 2
```

Then every hour, catch the errors that came in:

```bash
lore automation create errors --prompt triage --on hourly --only-if-work
```

And every morning, have the agent `bruce` do its rounds in `#ops`:

```bash
lore automation create rounds --prompt chat --agent bruce --room ops --text 'Do the morning rounds.' --on daily@7
```

## From the command line

```bash
lore automation list
```

```bash
lore automation run triage --wait
```

`lore automation update <name>` changes only the flags it is given;
`enable`, `disable` and `delete` do what they say; `lore automation settings
--builds-per-day 10` sets the project's daily build ceiling. The full list is
in the [CLI reference](/lore/docs/reference-cli).

## From an agent

`automation_list`, `automation_create`, `automation_update`,
`automation_delete`, `automation_run`, `automation_pause_all`,
`automation_resume_all` and `automation_settings` are the twins of `lore
automation`. Called with an agent job's own key, `automation_run` is refused:
a job never starts another.
