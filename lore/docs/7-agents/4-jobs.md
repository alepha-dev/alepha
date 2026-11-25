# Agent jobs

An agent job is an agent CLI, Claude Code or Gemini CLI, run by Lore on one of
your own hosts: a [prompt](/lore/docs/agents-prompts) run there, to triage the
feedback inbox and the open errors into quests, review an epic's plan, or
work a quest into a pull request. You
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
default one: with a single host, a run goes there; with several, **Run** asks
which. A run takes the first agent CLI the host reports, with its default
model.

## Sources and workspaces

Bay prepares the code a job works on before the agent starts, so the agent
never clones, fetches or resets. Each job has a **source**:

- **read**: the project's repository at the default branch, checked out at
  `./src` and made read-only. A triage, an epic's review, a pull request's
  review and a security check read. Any number of read jobs of a project run
  at once.
- **write**: a git worktree on a branch Lore names, `lore/q<number>` for a job
  on one quest and `lore/job-<id>` for any other. When the branch is already on
  GitHub the worktree continues it, so a follow-up on a quest (a CI fix, review
  comments) finds its work again. Working a quest, an epic or a feedback item,
  and a dependency update, write.
- **none**: an empty workspace, for a project with no GitHub repository. Its
  jobs work from Lore alone.

Read-only is a guard against a run changing the code other runs read, not a
sandbox: the jobs user can undo it.

Read and write need the project's **Repository URL** on GitHub
(`https://github.com/<owner>/<name>`), set in the project's settings. Without
one, a job that asks for read or write is refused before it is queued, and the
others run with no code.

The source is set on the prompt, never at a run: a built-in comes with its
own, and your own prompts say theirs. A prompt's **ref** names a branch, a tag
or a commit instead of the default branch.

```bash
lore prompt update release-notes --source read --ref v1.4.0
```

Each job runs in a **workspace**: a directory under the jobs user's home,
`~/bay-jobs/<project>/<workspace>`, kept between runs, its code at `./src` for
a read job. A job on one quest uses `q<number>`, one that writes on any
other subject `job-<id>`, and one that reads the shared read workspace. The repository itself is kept once
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

Each built-in prompt is described in [Prompts](/lore/docs/agents-prompts):
what it reads, what it writes back, and how its work lands. A run starts from
**Run** in Settings ▸ Prompts, from a page where the project pinned the
prompt, from the search palette, from `lore prompt run`, or on its own, from
the prompt's trigger.

A few things only a job does:

- **Triage** reads everything first, then groups what belongs together: one
  quest per real problem however many reports describe it, a report an open
  quest already covers joins that quest, an error that causes a report is
  forwarded to the same quest, noise is resolved, and an item it is unsure
  about stays pending with a question. Once an item is triaged, its **Agent
  job** link opens the job.
- **Review PR** reads a pull request's head; with **Push fixes to the pull request's branch** it works on
  the pull request's own branch, and is refused for a fork. A pull request is
  its author's text: before the agent starts, the host asks GitHub whether the
  author can write to the repository, and fails the job when they cannot. A
  member who trusts the author ticks **I trust the pull request's author** (or
  passes `--trust`), and the host asks nothing. A triggered run never can.
- **Work on quest**, **Work on epic** and **Work on feedback** run in a
  worktree on the work's branch, run the project's checks, commit naming the
  quest, push, and open a pull request with `gh`, which they record on the
  quest.

## A job's page

**Settings ▸ Prompts ▸ Jobs** lists every job of the project, newest first:
its prompt and the items it was given, what started it (you, an event, the
schedule), its host, status and duration. Filter by prompt, status or host.
A job belongs to the project, not to a host: no host page lists them.

A job's page names it by its prompt and its items, with its facts on the
side: who or what started it, the host, the agent CLI and its model, the
source and the commit, when it was queued, started and ended, its exit code,
and the turns, tokens and cost the agent CLI reports at its end. Three tabs:

- **Transcript**, first: on a failed job, why it failed; then the agent's
  final reply; then what the agent said and did, each tool call on one line
  that opens on its input and its result. Bookkeeping lines are hidden, with
  their count, and a line Lore cannot read is shown as it is.
- **Raw log**: the log line by line, stderr marked.
- **Prompt**: the words the agent received.

**Run again** runs the same prompt on the same items; **Cancel** stops a
running job. The page follows a running job as it goes.

A job's final reply is kept with the job, up to 32 KB. An Agent host whose
Bay predates it returns none: upgrade Bay on that host to see replies.

## From the command line

Start a run, and follow its log until it ends with `--wait`:

```bash
lore prompt run triage --wait
```

```bash
lore prompt run work-quest --quest Q42
```

```bash
lore prompt run review-pr --pr 118
```

`--host`, `--agent` and `--model` pick the host, the agent CLI and its model.
Without them, the project's only host, its first agent CLI and that CLI's own
default model apply.

```bash
lore job list
```

```bash
lore job logs <id> --follow
```

`lore job get <id>` shows what a job ran (prompt, args, agent, model,
workspace, source, branch and commit), how it ended and its reply; `lore job
cancel <id>` stops it. A job succeeds or fails by the agent's exit code: what
it did is what it wrote to Lore.

## From an agent

`prompt_run` starts a job and `agent_hosts` lists the Agent hosts, the twins
of `lore prompt run` and `lore agent hosts`; `job_list`, `job_get` and
`job_cancel` read and stop jobs. Called with an agent job's own key,
`prompt_run` is refused.

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
- A quest filed from untrusted feedback is marked **Untrusted** too: a run of
  **Work on quest** on it is refused until a member has clicked **Confirm its
  text** on the quest, and a run on an epic holding such a quest is refused
  until then. A quest filed
  from an item a member already trusted carries that confirmation.

## What Lore never sees

- **Your agent's sign-in, and your `gh` sign-in.** They stay with the jobs
  user on the host.
- **Your host's other files and secrets.** A job pulls its spec and nothing
  else; what the jobs user can reach on the host is yours to decide.
- **Your agent account.** Usage and billing stay between you and the agent's
  vendor.

What Lore does keep: the prompt it sent and the job's log, up to a size cap.
