# The lore CLI

`lore` is the command-line client for Lore: it signs in to an instance, reads
and writes quests and folios, and builds, pushes and deploys apps from a laptop
or a CI job. This page lists every command group with what it is for and the
flags you will reach for first; `lore <command> --help` has the rest.

## Install

```bash
npm i -g @alepha/lore
lore --help
```

Inside an Alepha workspace that already depends on `@alepha/lore`,
`yarn lore ...` works without the global install.

## Signing in

| Where                    | How                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------- |
| A machine with a browser | `lore login`, then approve the code it prints. `lore logout` forgets it.           |
| CI, or anything headless | Set `LORE_API_KEY` to an API key (`ak_...`) from your account's **API keys** page. |
| A self-hosted instance   | Set `LORE_URL` to its address, for both of the above.                              |

`lore login` uses the OAuth device flow: it prints an address and a code to
enter there. The session is stored per instance in `~/.alepha/credentials.json`,
refreshes itself, and ends after 30 days without a command, after 180 days at
most, or when you revoke it.

When a command runs, `LORE_API_KEY` wins over a stored login. With neither, the
command fails and says how to fix it: it never starts a login by itself, and
`lore login` refuses to run in CI, where nobody could approve the code.

## Choosing the project

Every project command looks for the project in this order:

1. `--project <slug>` (or `-p`);
2. the `LORE_PROJECT` environment variable;
3. the nearest `.alepha/lore.json`, found by walking up from the current
   directory.

`.alepha/lore.json` is written by `lore project link <slug>` and
`lore project create <name>`, and holds one field:

```json
{ "project": "my-project" }
```

## Conventions

- **Names follow the [MCP tools](/lore/docs/guides-mcp).** The agent tool
  `quest_create` is `lore quest create`. Planning is covered: projects, epics,
  quests, folios and directories. Some tools have no command yet (feedback,
  automations, blights, sigils, app instances and release management), and a
  command can still take fewer flags than its tool (`quest_create` has `dueAt`,
  `lore quest create` does not).
- **A delete needs `--yes`.** Nothing here prompts: an agent's shell has nothing
  to answer with.
- **Output** is human-readable by default. `--output json` prints JSON for
  scripts on the commands whose `--help` lists it: quests, folios and projects,
  but not `lore deploy` or `lore secrets`, for instance. Logs go to standard
  error, so piping the output stays clean; a command that only logs, like
  `lore secrets list`, leaves standard output empty.
- **Long text** (descriptions, folio content, messages) can be read from a file
  with `@file`, or from standard input with `@-`, on the flags whose help says
  so.
- **References.** A quest is `12`, `Q12` or `'#Q12'` (quoted, or the shell
  treats `#` as a comment). A folio is `F12`, an epic `45` or `E45`. The
  exception is `lore attachments push`: `--quest` and `--folio` take the bare
  number.
- **Exit codes.** `0` success, `1` failure (including a partial write), `3` not
  signed in, `4` not allowed. A credential Lore rejects (expired or revoked) is
  `3`, and a refused permission `4`, on the `project`, `quest`, `folio`,
  `estate`, `registry` and `stack` commands; the others exit `1` for both.

## Environment variables

| Variable       | What it does                                                                  |
| -------------- | ----------------------------------------------------------------------------- |
| `LORE_API_KEY` | The API key to authenticate with. Takes precedence over `lore login`.         |
| `LORE_URL`     | The instance. Defaults to `https://lore.alepha.dev`.                          |
| `LORE_PROJECT` | The project, when `--project` is not given.                                   |
| `LORE_APP`     | The app, for app commands. Defaults to the name in `package.json`, slugified. |
| `LORE_ENV`     | The environment, for `lore deploy` and `lore apps deploy`.                    |

## Commands

### Projects

| Command                         | What it does                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `lore project list`             | The projects you are a member of.                                                                                          |
| `lore project info`             | One project: its capabilities, areas and more.                                                                             |
| `lore project context`          | Orient yourself: areas, your quests, open epics, releases, folios and pinned folios.                                       |
| `lore project activity`         | What moved since `--since <timestamp>`, your own events included.                                                          |
| `lore project report [section]` | One [Reports](/lore/docs/guides-reports) section as JSON, `summary` by default. `--days N` sets the period, 30 by default. |
| `lore project create <name>`    | Create a project and link the current directory to it. `--no-link` skips the link.                                         |
| `lore project link <slug>`      | Link the current directory to an existing project. `--force` replaces another link.                                        |
| `lore project merge`            | Merge `--source` into `--target`, owners only. A dry run unless `--no-dry-run`: read the plan first.                       |

`lore project create` makes a project with the **Deploy and watch apps**
capability only, its **Deploy apps** option on and **Track apps** off. Turn on
the rest in the project's settings.

### Quests

| Command                           | What it does                                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `lore quest list`                 | Newest-updated first. `--status`, `--tag`, `--epic`, `--search`, `--include-drafts`, `--limit` (default 20, max 100), `--offset`. |
| `lore quest get <ref>`            | One quest with its description, objectives (and their ids) and discussion.                                                        |
| `lore quest create`               | `--title`, `--area`, `--priority` (required); `--description`, `--size`, `--tag`, `--objective`, `--epic`, `--accept`.            |
| `lore quest update <ref>`         | Change the title, description, area and other fields.                                                                             |
| `lore quest accept <ref>`         | Take the quest and start it.                                                                                                      |
| `lore quest objective set <ref>`  | Tick an objective by `--objective <id>`; `--no-completed` unticks it.                                                             |
| `lore quest comment add <ref>`    | `--body`; `--as <name>` marks it as written by an agent.                                                                          |
| `lore quest commit add <ref>`     | `--sha`, `--message`, `--repo`. Records a commit, on a completed quest too.                                                       |
| `lore quest hold <ref>`           | `--reason`, posted to the discussion. `lore quest unhold <ref>` lifts it.                                                         |
| `lore quest shelve <ref>`         | Set a todo quest aside. `lore quest unshelve <ref>` brings it back.                                                               |
| `lore quest unassign <ref>`       | Send an accepted quest back to todo.                                                                                              |
| `lore quest complete <ref>`       | `--message`, `--commit <sha>` (repeatable), `--waive <id>=<reason>` for an objective not done.                                    |
| `lore quest delete <ref>`         | For good, with `--yes`.                                                                                                           |
| `lore quest tags`                 | The tags the project uses.                                                                                                        |
| `lore quest attachment get <ref>` | `--attachment <id>`, as `quest get` lists it. Prints text; `--out <path>` saves anything.                                         |

`lore quest update` also takes `--epic` (`0` takes it out) and `--depends-on`
(`0` clears it); `lore quest create` takes `--depends-on`.

See [Quests](/lore/docs/guides-quests) for the statuses and rules behind these.

### Epics

| Command                      | What it does                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `lore epic list`             | Every epic, whatever its status.                                               |
| `lore epic get <ref>`        | One epic: status, progress, plan and its folios.                               |
| `lore epic create`           | `--title` (required); `--description`, `--depends-on`. Starts as a draft.      |
| `lore epic update <ref>`     | `--title`, `--description`, `--depends-on` (`0` clears it).                    |
| `lore epic set status <ref>` | `--status draft` or `ready`. The other statuses follow from its quests.        |
| `lore epic shelve <ref>`     | Set it and its open quests aside. `lore epic unshelve <ref>` brings them back. |
| `lore epic delete <ref>`     | With every quest in it, draft or ready only, with `--yes`.                     |

### Folios

| Command                              | What it does                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `lore folio list`                    | Pinned first, then newest-updated. `--epic` narrows to one epic.                             |
| `lore folio get <ref>`               | One folio: its summary and Markdown content.                                                 |
| `lore folio create`                  | `--title`, `--summary`, `--content` (required, `@file` works); `--directory`, `--epic`.      |
| `lore folio search <query>`          | The matches, each with a snippet.                                                            |
| `lore folio update <ref>`            | `--title`, `--summary`, `--content`, `--directory`, `--pinned`, `--epic` (`0` takes it out). |
| `lore folio history <ref>`           | Its revisions; `--output json` carries their content.                                        |
| `lore folio revert <ref>`            | `--revision <id>`. What it replaces stays in the history.                                    |
| `lore folio delete <ref>`            | For good, with `--yes`.                                                                      |
| `lore folio attachment list <ref>`   | A folio's files.                                                                             |
| `lore folio attachment rename <ref>` | `--name`, by the attachment's number.                                                        |
| `lore folio attachment delete <ref>` | With `--yes`, by the attachment's number.                                                    |

See [Folios](/lore/docs/guides-folios).

### Directories

| Command                        | What it does                                                |
| ------------------------------ | ----------------------------------------------------------- |
| `lore directory list`          | What the root holds, or `--directory <ref>`.                |
| `lore directory create <name>` | `--parent` to nest it.                                      |
| `lore directory rename <ref>`  | `--name`.                                                   |
| `lore directory move <ref>`    | `--parent`, or the root without it.                         |
| `lore directory delete <ref>`  | With `--yes`. `--cascade` also deletes everything it holds. |

### Attachments

```bash
lore attachments push ./chart.png --quest 1208
lore attachments push ./notes.pdf --folio 12 --name "Meeting notes.pdf"
```

One file per call, onto a quest or a folio. See
[Attachments](/lore/docs/guides-attachments).

### Releases

| Command                   | What it does                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `lore releases check`     | Fail when the open release tagged `--tag` still has unfinished quests.                                                          |
| `lore releases changelog` | Print that release's changelog as Markdown.                                                                                     |
| `lore releases cut`       | Bump `package.json` (`--bump` takes `major`, `minor` or `patch`), prepend the notes to `CHANGELOG.md`, commit and tag, locally. |
| `lore releases publish`   | Publish the release tagged `--tag`, if there is one.                                                                            |

See [Releases](/lore/docs/guides-releases) for how these fit in a release job.

The release's own record is here too, each naming it by `--tag`:

| Command                     | What it does                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `lore releases list`        | Every release, open and published.                                                 |
| `lore releases get`         | One release, with its epics and quests.                                            |
| `lore releases create`      | Create one. `--title`, `--description`, `--target-date`.                           |
| `lore releases update`      | Edit an open one. `--new-tag` moves its URL and breaks every shared link.          |
| `lore releases attach`      | Put an `--epic` or a `--quest` in it. An epic carries its quests.                  |
| `lore releases detach`      | Take one out.                                                                      |
| `lore releases reopen`      | Undo a publication.                                                                |
| `lore releases set default` | Point the project's intake at `--tag`, or `--clear` it.                            |
| `lore releases delete`      | Delete it. Needs `--yes`: a published release's frozen record exists nowhere else. |

`lore releases changelog --frozen` prints a release's changelog as Lore holds
it, published ones included. Without it the command serves a release job, and
refuses a published or incomplete release.

### Feedback

A reference is `120`, `P120` or `'#P120'`.

| Command                           | What it does                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| `lore feedback list`              | The pending inbox, newest first. `--status`, `--limit`, `--offset`.                |
| `lore feedback get <ref>`         | One item: its report, where it was made from, files, quests and discussion.        |
| `lore feedback attachment get`    | Read a file: text is printed, `--out` saves anything.                              |
| `lore feedback comment add <ref>` | Comment, with `--body`. The reporter is told. `--as <agent>` marks it a machine's. |
| `lore feedback accept <ref>`      | Accept it. Quests come from `lore quest create --feedback <ref>`.                  |
| `lore feedback reject <ref>`      | Reject it. The row stays.                                                          |

### Blights and insights

A reference is `12` or `B12`.

| Command                     | What it does                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `lore blight list`          | The inbox: one row per root cause, open ones unless `--include-resolved`.                              |
| `lore blight resolve <ref>` | Close it for good. Check `lore insights read --segment errors` first: a later report never reopens it. |
| `lore blight forward <ref>` | Turn it into a new quest and close it.                                                                 |
| `lore insights read`        | Analytics, vitals and the error budget. `--range`, `--segment`, `--traffic`.                           |

### Automations

A rule is JSON, usually in a file (`--rule @rule.json`):
`lore automation catalog` names what it may hold. Every write takes the
`--expected-revision` you read, so a rule edited since is refused rather than
overwritten.

| Command                                               | What it does                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| `lore automation catalog`                             | What a rule may say in this project.                            |
| `lore automation list`                                | The project's rules. `--search`, `--state`, `--author-user-id`. |
| `lore automation get <id>`                            | One rule, with its revision.                                    |
| `lore automation create`                              | Create one, disabled. `--enabled` enables it in a second step.  |
| `lore automation update <id>`                         | `--title` with `--rule`, or `--enabled` / `--no-enabled` alone. |
| `lore automation delete <id>`                         | Delete it. Needs `--yes`.                                       |
| `lore automation test <id>`                           | Preview it, with no writes and no delivery.                     |
| `lore automation runs <id>`                           | Its retained runs.                                              |
| `lore automation adoption preview <policy>`           | What adopting a legacy policy would do.                         |
| `lore automation adopt <policy>`                      | Adopt it, permanently. Needs `--confirm`.                       |
| `lore automation variable list/set/delete/dependents` | The project's shared variables.                                 |

### Quality

`lore quality push` sends the coverage and test totals of the last run to the
project's **Quality** report. `--branch` files them under another branch than
the checked-out one. It expects an Alepha project.

### Apps and deploys

| Command                | What it does                                                                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lore apps build`      | Build this app for one or more deploy targets.                                                                                                                                                              |
| `lore deploy`          | Deploy this app onto one of its environments. Without `--tag` it builds, pushes and deploys; with one it deploys that stored build. `--env`, `--app`, `--sigil` / `--no-sigil`. Same as `lore apps deploy`. |
| `lore apps redeploy`   | Deploy a stored build onto every copy of the app whose environment ends with `--suffix`.                                                                                                                    |
| `lore apps destroy`    | Take a copy down: `--env` and `--confirm <app>/<env>` are both required.                                                                                                                                    |
| `lore deploy status`   | Where a run got to, by `--deployment`, or a copy's newest by `--app` and `--env`.                                                                                                                           |
| `lore deploy rollback` | Go back to a `--deployment`. Code only: past a migration it needs `--acknowledge-migrations`.                                                                                                               |

The deployed copies themselves, each named by `--app` and `--env`:

| Command                     | What it does                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `lore apps instance list`   | Every copy this project tracks.                                                                                |
| `lore apps instance get`    | One copy, with what it has unlocked.                                                                           |
| `lore apps instance create` | Track a copy. Nothing is minted. `--url`, `--ephemeral`, `--estate <slug>` (one lent to the project).          |
| `lore apps instance update` | `--new-app`, `--new-env`, `--url`, `--estate <slug>`, or `--estate-id` (`0` clears it); not both estate flags. |
| `lore apps instance delete` | Forget a copy, its sigil and what it reported. It undeploys nothing. Needs `--yes`.                            |

A sigil is the key one copy reports with:

| Command                  | What it does                                                                |
| ------------------------ | --------------------------------------------------------------------------- |
| `lore sigil list`        | Every key, with when it last reported. Never a token.                       |
| `lore sigil create`      | Mint one for `--app` and `--env`, creating the copy if missing. Shown once. |
| `lore sigil rotate <id>` | Replace a token, keeping what it reported. Shown once.                      |
| `lore sigil delete <id>` | Delete it and that copy's analytics. Needs `--yes`.                         |

`lore secrets` manages the variables a deployed copy runs with. `--env` is
required, and no command ever prints a whole value (`list` shows a masked
prefix):

```bash
lore secrets set DATABASE_URL=postgres://... --env production
lore secrets set DATABASE_URL --env production   # value read from $DATABASE_URL
lore secrets set --file .env.production --env production
lore secrets list --env production
lore secrets unset DATABASE_URL --env production
```

See [Deploying an app](/lore/docs/guides-deploying) for the whole flow.

### Artifacts

| Command                     | What it does                                                             |
| --------------------------- | ------------------------------------------------------------------------ |
| `lore artifacts push`       | Pack the current build and push it. `--tag`, `--app`, `--force`.         |
| `lore artifacts push-image` | Record a container image CI pushed, by `--image` and `--digest`.         |
| `lore artifacts list`       | What was built, one line per tag. `--app`, `--tag`, `--limit`.           |
| `lore artifacts get`        | One tag's builds and digests. `--app`, `--tag`, `--runtime`, `--format`. |

See [Artifacts](/lore/docs/guides-artifacts).

### Estates

| Command                     | What it does                                                                                                                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lore estate add <slug>`    | Create a Bay estate, lend it to the project, and print the command to run on the machine. `--label`, `--allow-deploys`, `--output json` (`id`, `slug`, `deployAllowed`, `lore`, `secret`, `command`, so `\| jq -r .secret` works). |
| `lore estate list`          | The estates lent to the project, whether each is connected, and its current CPU and memory.                                                                                                                                        |
| `lore estate get <slug>`    | One of your estates: online or not, last seen, deploys, the projects it is lent to, and what the machine runs. `--output json`.                                                                                                    |
| `lore estate wait <slug>`   | Block until one of your estates is online, polling every 2 s; exit 1 on timeout with the last state seen. `--timeout` (seconds, default 120), `--output json`.                                                                     |
| `lore estate stats <slug>`  | One of your estates' CPU and memory: the current reading, then one mean per day. `--since`, `--output json`.                                                                                                                       |
| `lore estate update <slug>` | Turn deploys on (`--allow-deploys`) or off (`--no-allow-deploys`), or set the `--label`, of one of your estates. `--output json`.                                                                                                  |
| `lore estate rotate <slug>` | Mint a new secret for one of your Bay estates and print the connector command once; the old secret stops working at once. `--yes`, `--output json` (the shape `estate add` prints).                                                |
| `lore estate delete <slug>` | Delete one of your estates; refused while an app, a stack or a stack environment deploys to it. `--yes`, `--output json`.                                                                                                          |

See [Estates](/lore/docs/guides-estates).

### Container registries

| Command                       | What it does                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `lore registry add <host>`    | Store the project's credential for a registry. `--username`, and the token from standard input (`--password-stdin`) or `--password @file`. |
| `lore registry list`          | Hosts and usernames, never a secret.                                                                                                       |
| `lore registry remove <host>` | Forget the credential.                                                                                                                     |

### Stacks

A stack is a group of apps and services deployed together from one
`compose.yml` onto a Bay estate.

| Command                             | What it does                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `lore stack create`                 | Create a stack with its default `--estate`, and upload its first revision from `--file`.                                                        |
| `lore stack deploy`                 | Deploy to an environment (`-e`, default `production`), uploading `--file` as a new revision first. `--app` with `--tag` deploys one member app. |
| `lore stack rollback`               | Deploy an earlier revision again. Volumes and their data are untouched.                                                                         |
| `lore stack destroy`                | Forget an environment in Lore, and print the command that removes it from the machine.                                                          |
| `lore stack delete [name]`          | Delete a stack with no environment left, its routes and revisions; refused while one remains. `--yes`.                                          |
| `lore stack list`                   | The project's stacks and their environments.                                                                                                    |
| `lore stack get`                    | One stack: routes, services and newest deploys of each environment. `--env` narrows it. Never a value.                                          |
| `lore stack revisions`              | A stack's revisions, newest first.                                                                                                              |
| `lore stack secrets set/list/unset` | A stack environment's variables. `set` takes `KEY=VALUE`, `KEY` (read from `$KEY`), `--file`, or `--generate` for random values.                |
| `lore stack route add/list/remove`  | Serve a full domain from one service.                                                                                                           |
| `lore stack ps`                     | The services: state, memory, restarts and image digest.                                                                                         |
| `lore stack logs <service>`         | The tail of one service's logs.                                                                                                                 |
| `lore stack restart <service>`      | Restart one service.                                                                                                                            |

`--name` picks the stack and defaults to the project slug. See
[Stacks](/lore/docs/guides-stacks) for Lore's side, and
[Stacks](/bay/docs/guides-stacks) in the Bay documentation for the file's format.
