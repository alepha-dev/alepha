# GitHub

Connecting a project to a GitHub repository lets Lore follow its work: the
commits and pull requests that name a quest attach themselves to it, a pull
request's state, checks and review show beside the quest, GitHub's events can
notify people or start a prompt, and agent jobs push and open pull requests
with a token of their own.

Lore talks to GitHub through one **GitHub App** per Lore instance. On
lore.alepha.app it is set up already; on a Lore you host yourself, an instance
admin creates it once (see [Setting up the GitHub App](#setting-up-the-github-app)).

## Connecting a project

In **Settings ▸ General**, the **GitHub** card shows the repository the
project is connected to, or **Connect GitHub**. Connecting needs the
`project:update` permission.

1. Press **Connect GitHub**. GitHub opens on the App's install page.
2. Pick the account or organization, then the repository. Install the App on
   that repository only: Lore never needs more.
3. GitHub sends you back to Lore, which checks that your own GitHub account
   reaches the repository you picked, then connects it.

A project holds one repository, and a repository belongs to one project. To
change it, press **Disconnect**, then connect the other one. Disconnecting
keeps what was recorded: the commits and pull requests already on quests stay
there.

GitHub can also end a connection: the App uninstalled or suspended, or the
repository removed from the installation. The card then says so, with
**Connect again**.

### What the App can reach

The App sees the repositories it is installed on and nothing else, and Lore
uses each project's connection for that one repository. It asks GitHub for:

| Permission    | Access | Why                                                                    |
| ------------- | ------ | ---------------------------------------------------------------------- |
| Metadata      | read   | Every App has it: the repository's name and default branch.            |
| Contents      | write  | Agent jobs clone, commit and push; Lore reads workflow files.          |
| Pull requests | write  | Agent jobs open pull requests and post reviews.                        |
| Checks        | write  | A pull request's checks, by name, on the quest and the job page.       |
| Commit status | write  | The same for CI systems that report statuses rather than checks.       |
| Actions       | write  | Starting, re-running and cancelling workflows from the Workflows page. |

The App never asks for **Workflows**: nothing done through Lore can change a
file under `.github/workflows`, and an agent job's push touching one is
refused by GitHub.

Each token Lore asks GitHub for is narrower than this: scoped to the one
repository and to the permissions that action needs, and valid one hour at
most.

## Commits and pull requests on quests

A commit or a pull request finds its quest when it names it as `#Q12`:

- a commit, in its message, once it is pushed to the repository;
- a pull request, in its title or its description, or by its branch when
  that is `lore/q12`, the branch an agent job works on for quest 12.

The quest then lists the commit, and the pull request with its state (open,
draft, merged, closed), its checks (passing, failing, pending) and its review.
A pull request naming an epic as `#E3` attaches to the epic the same way.

A pull request whose author has no write access to the repository is marked
**Outside the team**. No prompt trigger acts on it until a member presses
**Trust** on it, since its title and description were written by someone
outside the project.

## Events and prompt triggers

Once a project is connected, **Settings ▸ Notifications** offers GitHub's
events, to subscribe a member, Discord or a webhook to:

- Pull request opened on GitHub, ready for review, merged, closed unmerged;
- review requested, pull request reviewed;
- checks failing, checks passing;
- pull request trusted;
- a workflow run failed on the default branch.

The same events can start a [prompt](/lore/docs/agents-prompts). For example,
a prompt with a `pullRequest` argument and the trigger **Pull request opened
on GitHub** reviews every new pull request on its own; another on **Checks
failing** can read the failing checks and propose a fix.

## Workflows

The **Workflows** page, under Ship, lists the repository's workflows that
declare `workflow_dispatch`, each with **Run**. Run opens a form built from
the workflow's inputs, with the branch or tag to run it on. Below, the recent
runs show their outcome and who started them from Lore, with **Re-run**,
**Re-run failed jobs** and **Cancel**.

Starting, re-running and cancelling need the `deploy:workflow` permission,
held by the owner and the Admin rank. Each one is written to the project's
Activity with who asked and, for a run, its inputs. An agent job can never
start, re-run or cancel a workflow through Lore.

## Agent jobs

An [agent job](/lore/docs/agents-jobs) of a connected project carries its own
GitHub token, made when its host picks the job up and renewed while it runs:

- it reaches the project's repository only;
- a read job reads the code; a write job also pushes; both can open pull
  requests, post reviews, and read checks, statuses and workflow runs;
- its commits and pull requests are made by the App's bot,
  `<app-name>[bot]`;
- nothing needs signing in on the host: the jobs user's `gh` is used only for
  projects that are not connected.

The job's page says which credential it ran with: **The GitHub App's token**,
or **The host's gh login**. The host needs a Bay recent enough to take job
tokens; an older one runs jobs on the jobs user's own `gh` login, as before.

## What Lore does not do

- It does not merge a pull request.
- It does not change workflow files.
- It does not complete a quest when its pull request merges: completing stays
  your call, or the agent's.

## From the command line

```bash
lore github status
lore github install          # prints the install link to open in a browser
lore github disconnect
lore pull-request trust 118
lore workflow list
lore workflow run --workflow-id 4242 --ref main --inputs bump=minor
lore workflow rerun --run-id 9001 --failed-only
lore workflow cancel --run-id 9001
```

## From an agent

The MCP tools `github_status`, `github_install`, `github_connect`,
`github_disconnect`, `pull_request_trust`, `workflow_list`, `workflow_run`,
`workflow_rerun` and `workflow_cancel` do what the commands above do.

## Setting up the GitHub App

On a Lore you host yourself, an instance admin creates the GitHub App once,
in **Admin ▸ GitHub**. Lore needs `PUBLIC_URL` set to its public address, and
that address reachable from GitHub: GitHub posts its events to
`<PUBLIC_URL>/api/github/webhook`.

### Creating it from the Admin page

1. Open **Admin ▸ GitHub**. Give the App a name (it must be unique on GitHub),
   and an **Organization** to own it, or leave that empty for your own
   account.
2. Press **Create the GitHub App**. GitHub shows the App it is about to
   create, with its permissions and events; confirm.
3. GitHub sends you back to Lore, which stores the App's id, keys and secrets,
   encrypted.

The page then shows the App: where it comes from, its slug, the install link,
the webhook URL and when the webhook was last reached.

### Registering it by hand

To keep the App's secrets in your own secret store, create the App on GitHub
yourself, with the permissions and events above, the webhook URL
`<PUBLIC_URL>/api/github/webhook`, the callback URL
`<PUBLIC_URL>/github/connect`, and **Request user authorization (OAuth)
during installation** on. Then set, all of them:

| Variable                    | Value                                          |
| --------------------------- | ---------------------------------------------- |
| `GITHUB_APP_ID`             | The App's id.                                  |
| `GITHUB_APP_SLUG`           | The App's slug, from its public page's URL.    |
| `GITHUB_APP_CLIENT_ID`      | The App's client id.                           |
| `GITHUB_APP_CLIENT_SECRET`  | A client secret of the App.                    |
| `GITHUB_APP_WEBHOOK_SECRET` | The webhook secret you gave the App.           |
| `GITHUB_APP_PRIVATE_KEY`    | A private key of the App, the `.pem` contents. |

An App in the environment wins over one created from the Admin page.

### Checking deliveries

**Admin ▸ GitHub** lists the recent deliveries: their event, repository,
outcome and attempts. A delivery Lore missed (the instance was down) is asked
for again on its own within the hour. On GitHub, the App's **Advanced** tab
shows what GitHub sent and what Lore answered.

### Rotating secrets

For an App in the environment, generate a new private key or webhook secret
on GitHub, set the variable, restart Lore, then delete the old key on GitHub.

For an App created from the Admin page, generate the new key or secret on
GitHub, then give it to Lore:

```bash
lore github rotate --private-key @new-key.pem
echo "$NEW_SECRET" | lore github rotate --webhook-secret @-
```

Then delete the old key on GitHub.

**Forget this App**, on the Admin page, removes the stored App from Lore:
connected projects stop receiving GitHub's events, and agent jobs lose their
GitHub token. The App stays on GitHub, where its owner deletes it.
