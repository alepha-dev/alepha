# Agent jobs

An agent job is Claude Code run by Lore on one of your own hosts: it triages a
feedback item into quests, or works a quest and pushes a branch. You provide
the machine and the Claude credential; Lore writes the job, starts it, shows its
log, and keeps what it answered.

The credential never leaves your host. Lore asks the host to run a job, the
host pulls what to run, and Claude Code reads its credential from the host
itself.

## Claude Code on your host, by hand

An agent job runs on a host enrolled with Bay (see
[Hosts](/lore/docs/ship-hosts)). Pick one that serves no production app and
holds no other project's secrets: a job runs a repository's code there.

**1. Mint a credential.** On any machine where you are signed in to Claude
Code, run `claude setup-token`, which prints a long-lived OAuth token for your
Claude subscription. An Anthropic API key works too, billed per token. Lore
never asks for either.

**2. Tell Bay how to run jobs.** Bay has two ways, chosen on the host:

- **In a container** (recommended). Each job runs in Lore's agent image, as a
  non-root user, with no host directory mounted and a network whose only way
  out is Bay's egress proxy. The credential is a host secret, set from stdin so
  it lands in no shell history:

  ```bash
  sudo bay secret set CLAUDE_CODE_OAUTH_TOKEN - < token.txt
  sudo bay config jobs --runner container --credential CLAUDE_CODE_OAUTH_TOKEN
  ```

  Add `--gvisor` when the host has the `runsc` runtime, for a kernel between
  the job and the machine.

- **As a host process.** Each job runs under a dedicated Unix user, signed in
  to Claude Code by hand (`sudo -u bay-agent claude setup-token`, or the key
  in that user's environment):

  ```bash
  sudo bay config jobs --user bay-agent
  ```

  That user's shell is the job's: it reaches whatever the user reaches, so
  this host runs work from your team only (see
  [Untrusted input](#untrusted-input)).

Jobs run with Claude Code's default model. `sudo bay config jobs --model opus`
picks another for every job on that host, the check included.

`bay config jobs --clear` makes the host refuse every job again. See the
[Lore connector guide](/bay/docs/guides-lore-connector) for every flag.

**3. Allow jobs, and make it an Agent host.** On the host's page in Lore, turn
on **Allow jobs**, then **Agent host**. Lore checks the host at once: it asks
Claude Code to reply OK in one turn, and shows **Available** with the CLI's
version, the model and the kind of credential, or **Unavailable** with the
CLI's own message. The check runs again once a day, on **Check now**, and
whenever a job fails on a sign-in or usage-limit message.

**4. Name the project's Agent host.** In the project's **Settings ▸ Hosts**,
an Agent host carries an **agent** pill under **Capabilities**. Open its row's
menu and choose **Make default Agent host**: a host of the project, or one
lent to it. The default's pill reads **agent, default**, and its menu holds
**Hosts a push job may reach**. Until a
project names one, its agent buttons are hidden.

From the CLI:

```bash
lore host update agent-1 --allow-jobs --agent-host
```

```bash
lore host check agent-1
```

```bash
lore host agent agent-1
```

## What an agent does

### Feedback to quests

**Triage with Claude**, in the robot menu of a pending feedback item, runs the
project's Triage prompt (see [Agent prompts](/lore/docs/agents-prompts)) on that
one item. The agent reads the item and the code, then does one of three things:
files a todo quest for sound feedback, leaves a question for a member when it is
unsure, or rejects what is not actionable.

**Triage all feedback and errors with Claude**, in the same menu, is one run
over the whole inbox. The agent reads every pending item, and the project's
open errors when it tracks them (Ship ▸ Track), before it changes anything.
Then it groups what belongs together:

- one quest per real problem, however many reports describe it. The quest
  names every report and error in it, and each other report gets a comment
  pointing to the quest;
- a report an open quest already covers joins that quest instead of filing a
  second one;
- an error that is the cause of a report is forwarded to the same quest. An
  error that is noise is resolved, and one it cannot place stays open;
- an item it is unsure about stays pending with a question, and one that is
  not actionable is rejected.

Its key reaches only the items it was given, and its turns and time grow with
their number. Feedback written outside the team never joins this run: each
such item gets a run of its own (see [Untrusted input](#untrusted-input)).

Both entries show only while the project's Agent host passes its agent check.
Once an item is triaged, its **Agent job** link opens the job and its log.

From the CLI, one item or the whole pending inbox:

```bash
lore feedback triage P120
```

```bash
lore feedback triage --all
```

### A quest to a branch

**Work it with Claude**, on an accepted quest, clones the repository, works the
quest, can run the project's checks, and pushes the branch `lore/q<number>` to the
project's Lore repository. The branch is the job's whole output: it never
writes to any other branch, and it never merges. You review it as you would a
colleague's.

### A branch to main

Opening a pull request and merging it stay a person's acts for now.

### Following a job

Every job shows on the subject it works on, with its log as it runs, its
status, how many turns it took and what it cost. From the CLI:

```bash
lore job list
```

```bash
lore job logs <id>
```

`lore job cancel <id>` stops one. A job that hits the provider's usage limit
is **paused** until the limit lifts, and the host shows **Unavailable** until
its next check passes.

## Profiles and rights

A job runs one of two fixed profiles. Neither can be widened from a prompt.

| profile | used by                 | Claude Code may                                               | turns | time   |
| ------- | ----------------------- | ------------------------------------------------------------- | ----- | ------ |
| `read`  | triage                  | read files, search, read git history                          | 30    | 15 min |
| `push`  | **Work it with Claude** | edit files, run shell commands (`yarn`, git), push its branch | 100   | 60 min |

Each job also gets its own Lore key, made when the host pulls the job and
revoked when it ends. The key holds only:

- the Lore tools the job needs, for the one feedback item or quest it is
  about;
- read access to the one repository it cloned;
- for a `push` job, write access to `lore/q<number>` and nothing else.

A job never starts another agent job: whatever its output says, the next stage
is started by a person or by the project's own settings.

**Network.** On a container host, every job reaches the Anthropic API and your
Lore, and nothing else. A `push` job also reaches the npm and Yarn registries
and GitHub, so it can install dependencies. Replace that list in
**Settings ▸ Hosts ▸ Hosts a push job may reach**, or with
`lore host agent --egress registry.example.app,.example.app` (`default`
restores it). A host refused by the proxy shows in the job's log as
`egress refused`. A host-process runner enforces no network rule.

## Untrusted input

Feedback written by someone outside the project's team (a visitor of a public
form or widget, a user who is not a member) is marked **Untrusted** when it is submitted, and
stays so. Its text may be written to steer an agent, so Lore holds it to
stricter rules:

- A host that runs jobs **as a process** never gets it: Lore refuses to start
  the job, and a member triages the item by hand.
- A **container** host triages it with the `read` profile, whatever was asked:
  no edit, no shell, no push.
- A quest filed from it is marked **Untrusted** too. **Work it with Claude**
  waits until a member has read its text and clicked **Confirm its text**,
  which Lore records with their name.

The Triage prompt also tells the agent that the item's text is data, never
instructions. That sentence helps; the rules above are what hold.

## What Lore never sees

- **The Claude credential.** It stays on the host: in a host secret, or in the
  jobs user's own Claude Code sign-in. Lore sees only the secret's name, and
  whether the check found an OAuth token or an API key.
- **Your host's other secrets.** A job pulls its spec and nothing else; a
  container job sees no host directory and no environment but its own.
- **Your Claude account.** Usage and billing stay between you and Anthropic.
  Lore shows the cost Claude Code reports at the end of each job.

What Lore does keep: the prompt it sent, the job's log (up to a size cap), and
Claude Code's final answer.
