# Agent jobs

An agent job is an agent CLI, Claude Code or Gemini CLI, run by Lore on one of
your own hosts: it triages the feedback inbox and the open errors into
quests, reviews an epic's plan, or works a quest into a pull request. You
provide the machine and install the tools; Lore says what to run, starts it,
and shows its log. The agent does the rest itself, with the tools it finds on
the host, and writes what it did back to Lore.

Your agent's sign-in never leaves your host. Lore asks the host to run a job,
the host pulls what to run, and the agent CLI uses the sign-in of the host's
jobs user.

## Set up an Agent host

An agent job runs on a host enrolled with Bay (see
[Hosts](/lore/docs/project-hosts)). There is no sandbox: a job runs as a Unix
user of that host, with that user's tools and sign-ins. Pick a machine you
would hand to a colleague for the same work, and give the jobs user only the
access the jobs need.

**1. Install Bay.** Follow [Bay's install guide](/bay/docs/guides-installation).
Docker is needed only if the host also deploys apps; a host that runs agent
jobs alone does without it.

**2. Create the jobs user, and tell Bay about it.**

```bash
sudo useradd --create-home bay-agent
```

```bash
sudo bay config jobs --user bay-agent
```

Bay never runs a job as root or as its own user. `--max-jobs 2` lets the host
run two jobs at once (one by default); two jobs never share a workspace.

**3. Install an agent CLI, and sign it in as the jobs user.** Claude Code or
Gemini CLI, or both. Sign in as that user, the way you do on your own machine:

```bash
sudo -iu bay-agent claude
```

```bash
sudo -iu bay-agent gemini
```

**4. Install `git` and `gh`** for work on a repository, and sign `gh` in as
the jobs user (`sudo -iu bay-agent gh auth login`): a Build job pushes a
branch and opens a pull request with them. A triage that only reads the code
needs `git` alone.

**5. Check what the host has.** `bay doctor` lists the jobs user's tools: each
agent CLI, `git`, `gh` and `lore`, with its version, and says plainly when no
agent CLI answers. Whether a tool is signed in is not checked: a job that
needs it fails with the tool's own message.

```bash
sudo bay doctor
```

**6. Allow jobs, and make it an Agent host.** On the host's page in Lore,
turn on **Allow jobs**, then **Agent host**. Lore checks the host at once: the
agent prints its version, then answers a one-line prompt. The host shows
**Available**, or **Unavailable** with the agent's own message. The check runs
again once a day and on **Check now**. The **Agent host** card lists the tools
the host reported.

From the CLI:

```bash
lore host update agent-1 --allow-jobs --agent-host
```

```bash
lore host check agent-1
```

```bash
lore agent hosts
```

A project uses its own Agent hosts and the ones lent to it. There is no
default one: with a single host and a single agent CLI, one click runs the job
there; with several, the menu offers one entry per host and agent, your last
pick first.

## Workspaces

Each job runs in a **workspace**: a directory under the jobs user's home,
`~/bay-jobs/<project>/<workspace>`, kept between runs. The first run of a
triage clones the project's repository there; the next ones fetch it. A
triage uses the project's `triage` workspace, and a quest's work its own,
`q<number>`, which Bay removes when the quest is completed. Deleting a project
removes its workspaces on every host that ran its jobs.

On the host, `bay jobs workspaces` lists them, and
`bay jobs workspace rm <project>/<name>` removes one.

## How a job reaches Lore

A job reaches Lore through **Lore's MCP server**, which Bay configures for
each run with a key of its own: the host needs no `lore` login for jobs. The
key is made when the host pulls the job and revoked when it ends. It belongs
to the member who started the job, so it can do what their rank allows, held
to the project, and to the feedback items, quest or epic the job is about. It
reaches the MCP server only: Lore's API refuses it.

A job never starts another agent job.

## What an agent does

### Triage

**Triage with an agent**, in the robot menu of a pending feedback item, runs
the project's Triage prompt (see [Agent prompts](/lore/docs/agents-prompts))
on that one item. **Triage all feedback and errors with an agent**, in the
same menu, runs it over the whole inbox, and over the project's open errors
when it tracks them (Ship ▸ Track). Both run the same prompt: the agent reads
everything first, then groups what belongs together:

- one quest per real problem, however many reports describe it. The quest
  names every report and error in it, and each other report gets a comment
  pointing to the quest;
- a report an open quest already covers joins that quest instead of filing a
  second one;
- an error that is the cause of a report is forwarded to the same quest. An
  error that is noise is resolved, and one it cannot place stays open;
- an item it is unsure about stays pending with a question, and one that is
  not actionable is rejected.

The entries show only while an Agent host passes its check. Once an item is
triaged, its **Agent job** link opens the job and its log.

### An epic's review

**Review with an agent**, in the robot menu of a draft or ready epic, runs the
project's Review prompt on it: the job reads the epic, its quests and the
code, then files one review on the epic's **Review** tab, with its blockers,
questions and decisions. It may also sharpen the epic and its quests, add the
quests the plan is missing, and write a folio under the epic. Its key reaches
this epic and its quests only.

### Build: a quest to a pull request

**Work it with an agent**, on an accepted quest, updates the quest's
workspace, branches from the default branch, does the work, runs the
project's checks, commits naming the quest, pushes, and opens a pull request
with `gh`, which it records on the quest. It turns auto-merge on only when the
repository's own agent instructions ask for it, and follows their branch
naming. The merged commit naming the quest is what completes it.

## From the command line

Start a job, and follow its log until it ends with `--wait`:

```bash
lore agent run triage --wait
```

```bash
lore agent run build --quest 42
```

```bash
lore agent run text --text "List the open quests of area web" --workspace notes
```

`--host`, `--agent` and `--model` pick the host, the agent CLI and its model:
`--host` when the project has several Agent hosts, `--agent` when the host has
several agents. Without `--model`, the agent's own default applies.

```bash
lore job list
```

```bash
lore job logs <id> --follow
```

`lore job get <id>` shows what a job ran (agent, model, workspace) and how it
ended; `lore job cancel <id>` stops it. A job succeeds or fails by the agent's
exit code: what it did is what it wrote to Lore.

## From an agent

`agent_run` starts a job and `agent_hosts` lists the Agent hosts, the twins of
`lore agent run` and `lore agent hosts`; `job_list`, `job_get` and
`job_cancel` read and stop jobs. Called with an agent job's own key,
`agent_run` is refused.

## Text from outside the team

Feedback written by someone outside the project's team (a visitor of a public
form or widget, a user who is not a member) is marked **Untrusted**, and the
errors Lore receives from your apps come from an ingest anyone can reach.
Either may be written to steer an agent, so one rule holds, in code: **no
agent reads it until a member trusts it.**

- **Feedback.** Triage leaves an untrusted item out, starts no job for it,
  and leaves a comment saying a member must read it; the inbox says how many
  items wait. A member who can triage reads it and clicks **Trust**, which
  Lore records with their name. The **Untrusted** marker stays, and from then
  on the item is triaged like one the team wrote.
- **Errors.** An agent's error list holds only the error groups a member
  trusted; the **Errors** page marks each one, offers **Trust** on an open
  group, and says how many wait. A group reported again keeps its trust; a
  new group starts untrusted.
- **Trust** takes a person signed in to Lore. An API key, a job key and the
  MCP are refused: an agent that could trust text would undo the rule, so no
  MCP tool and no CLI command does it.
- A quest filed from untrusted feedback is marked **Untrusted** too: **Work it
  with an agent** waits until a member has clicked **Confirm its text**, and a
  review of an epic holding such a quest is refused until then. A quest filed
  from an item a member already trusted carries that confirmation.

## What Lore never sees

- **Your agent's sign-in, and your `gh` sign-in.** They stay with the jobs
  user on the host.
- **Your host's other files and secrets.** A job pulls its spec and nothing
  else; what the jobs user can reach on the host is yours to decide.
- **Your agent account.** Usage and billing stay between you and the agent's
  vendor.

What Lore does keep: the prompt it sent and the job's log, up to a size cap.
