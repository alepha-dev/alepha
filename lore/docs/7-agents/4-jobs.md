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
run two jobs at once (one by default), and Lore sends it up to that many.
Jobs that only read the code share a workspace; a job that changes code has
its workspace to itself.

**3. Install an agent CLI, and sign it in as the jobs user.** Claude Code or
Gemini CLI, or both. Sign in as that user, the way you do on your own machine:

```bash
sudo -iu bay-agent claude
```

```bash
sudo -iu bay-agent gemini
```

**4. Install `git` and `gh`, and sign `gh` in as the jobs user.** A job that
reads or changes the project's code needs the project's repository on GitHub
and `gh` signed in: Bay fetches the code through it, and a job pushes and opens
pull requests with it. Install `cf` too if your prompts deploy with
Cloudflare's CLI, and sign it in the same way.

```bash
sudo -iu bay-agent gh auth login
```

Install the `lore` CLI only if a prompt asks for it, and **never sign it in**
as the jobs user: a job reaches Lore with a key held to its project and its
subject, and a signed-in CLI would reach past that.

**5. Check what the host has.** `bay doctor` lists the jobs user's tools: each
agent CLI, `git`, `gh`, `cf` and `lore`, with its version and whether it is
signed in, and says plainly when no agent CLI answers or when `lore` is signed
in. A job fails at once, before its agent starts, when a tool it needs says it
is signed out: its agent CLI, and `gh` for a job that reads or changes code.
The reason names the tool and the command that signs it in.

```bash
sudo bay doctor
```

**6. Allow jobs, and make it an Agent host.** On the host's page in Lore,
turn on **Allow jobs**, then **Agent host**. Lore checks the host at once: the
agent prints its version, then answers a one-line prompt. The host shows
**Available**, or **Unavailable** with the agent's own message. The check runs
again once a day and on **Check now**. The host's **Tools** section lists what
the jobs user has, installed or not, with its version and its sign-in, and the
**Agent host** card says how many jobs run, of how many the host allows.

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

## Sources and workspaces

Bay prepares the code a job works on before the agent starts, so the agent
never clones, fetches or resets. Each job has a **source**:

- **read**: the project's repository at the default branch, checked out at
  `./src` and made read-only. A triage, an epic's review, a pull request's
  review, a security check and a `text` run read. Any number of read jobs of a
  project run at once.
- **write**: a git worktree on a branch Lore names, `lore/q<number>` for a job
  on one quest and `lore/job-<id>` for any other. When the branch is already on
  GitHub the worktree continues it, so a follow-up on a quest (a CI fix, review
  comments) finds its work again. A build and a dependency update write.
- **none**: an empty workspace, for a project with no GitHub repository. Its
  jobs work from Lore alone.

Read-only is a guard against a run changing the code other runs read, not a
sandbox: the jobs user can undo it.

Read and write need the project's **Repository URL** on GitHub
(`https://github.com/<owner>/<name>`), set in the project's settings. Without
one, a job that asks for read or write is refused before it is queued, and the
others run with no code.

A `text` run reads the code: one that changes code asks for it with
`--source write`. `--ref` names a branch, a tag, a commit or `pull/<n>/head`
instead of the default branch.

```bash
lore agent run text --text "Bump the copyright year" --source write
```

```bash
lore agent run text --text "Explain the release script" --ref v1.4.0
```

Each job runs in a **workspace**: a directory under the jobs user's home,
`~/bay-jobs/<project>/<workspace>`, kept between runs, its code at `./src` for
a read job. A triage uses the `triage` workspace, a review `review`, a `text`
run `text`, and a quest's work `q<number>`. The repository itself is kept once
per project on the host, in a mirror Bay fetches at most every 30 seconds
(`bay config jobs --fetch-ttl`), so a burst of jobs fetches once.

**A write worktree goes when its job ends**, whatever the outcome, once every
commit is pushed and nothing is left uncommitted. Otherwise Bay keeps it, the
job shows **kept** with the count of unpushed commits, and the next job on that
workspace is refused until someone pushes or removes it. Deleting a project
removes its workspaces on every host that ran its jobs.

The job's page and `lore job get <id>` show the source, its ref or branch, the
commit the job ran on, and a kept worktree's warning.

On the host, `bay jobs workspaces` lists the workspaces, the mirror, the read
trees and the kept worktrees, and `bay jobs workspace rm <project>/<name>`
removes one.

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
on that one item. **Triage feedback and errors with an agent**, in the same
menu and in the robot menu of the errors inbox, runs it over the whole inbox,
and over the project's trusted open errors when it tracks them (Ship ▸
Track). Both run the same prompt: the agent reads
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

### A pull request's review

**Review #n**, under a quest's pull requests, runs the project's pull request
Review prompt on it: the job reads the pull request's head, its diff, the
quest and the repository's instructions, posts a review with `gh pr review`,
and sums it up on the quest. **Review and fix #n** runs the same prompt on the
pull request's own branch, and may push to it; it is refused for a pull
request from a fork.

A pull request is its author's text. Before the agent starts, the host asks
GitHub whether the author can write to the repository, and fails the job when
they cannot. A member who trusts the author ticks **I trust its author** (or
passes `--trust`), and the host asks nothing. An automation never can.

```bash
lore agent run review-pr --pr 118 --quest 42
```

### The dependencies

**Security check** audits the dependencies from the lockfile and files one
quest per real vulnerability, or comments on the open one that covers it.
**Dependency update** updates the dependencies a run names, or the ones a minor
or patch version behind, runs the project's checks, and opens a pull request
only when they pass. Run either by hand or as an
[automation](/lore/docs/agents-automations).

```bash
lore agent run security-check
```

```bash
lore agent run dependency-update --text "react, vite"
```

### Build: a quest to a pull request

**Work it with an agent**, on an accepted quest, runs in a worktree on the
quest's branch, does the work, runs the project's checks, commits naming the
quest, pushes, and opens a pull request with `gh`, which it records on the
quest. It turns auto-merge on only when the
repository's own agent instructions ask for it, and follows their branch
naming. A quest a [Build automation](/lore/docs/agents-automations) built
completes when the commit naming it reaches the default branch.

## Automations

To run a prompt on its own, at each new feedback item or every hour, make it
an [agent automation](/lore/docs/agents-automations).

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

`lore job get <id>` shows what a job ran (agent, model, workspace, source,
branch and commit) and how it ended; `lore job cancel <id>` stops it. A job succeeds or fails by the agent's
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
- **Errors.** An agent's error list holds only the trusted error groups;
  the **Errors** page marks each one, offers **Trust** on an open group, and
  says how many wait. An error your app's server reports is trusted on
  arrival: no browser can pass for it, since your app's server labels
  everything a browser reports as a browser error, and a refusal such as a
  400 or a 404 is never reported, so the usual echoes of a visitor's input
  do not arrive. A browser error and an uptime outage start untrusted. A group
  reported again keeps its trust.
- **Withdraw trust** puts a trusted group back out of an agent's reach, for
  a server error whose message carries outside text (a driver message
  quoting a value, a third party's response). It stays withdrawn when the
  group is reported again, until a member trusts it.
- **Trust** and **Withdraw trust** take a person signed in to Lore. An API
  key, a job key and the MCP are refused: an agent that could trust text
  would undo the rule, so no MCP tool and no CLI command does it.
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
