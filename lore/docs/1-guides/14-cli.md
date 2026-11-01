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
  `quest_create` is `lore quest create`. The CLI covers less: a command can take fewer flags than
  its tool (`quest_create` has `dueAt`, `lore quest create` does not), and some
  tools have no command (`quest_hold`, `quest_comment_add`, `folio_update`,
  every `epic_*`).
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
| `lore project report [section]` | One [Reports](/lore/docs/guides-reports) section as JSON, `summary` by default. `--days N` sets the period, 30 by default. |
| `lore project create <name>`    | Create a project and link the current directory to it. `--no-link` skips the link.                                         |
| `lore project link <slug>`      | Link the current directory to an existing project. `--force` replaces another link.                                        |

`lore project create` makes a project with the **Deploy and watch apps**
capability only, its **Deploy apps** option on and **Track apps** off. Turn on
the rest in the project's settings.

### Quests

| Command                          | What it does                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `lore quest list`                | Newest-updated first. `--status`, `--tag`, `--epic`, `--limit` (default 20, max 100), `--offset`.                      |
| `lore quest get <ref>`           | One quest with its description, objectives (and their ids) and discussion.                                             |
| `lore quest create`              | `--title`, `--area`, `--priority` (required); `--description`, `--size`, `--tag`, `--objective`, `--epic`, `--accept`. |
| `lore quest update <ref>`        | Change the title, description, area and other fields.                                                                  |
| `lore quest accept <ref>`        | Take the quest and start it.                                                                                           |
| `lore quest objective set <ref>` | Tick an objective by `--objective <id>`; `--no-completed` unticks it.                                                  |
| `lore quest complete <ref>`      | `--message`, `--commit <sha>` (repeatable), `--waive <id>=<reason>` for an objective not done.                         |

See [Quests](/lore/docs/guides-quests) for the statuses and rules behind these.

### Folios

| Command                | What it does                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `lore folio list`      | Pinned first, then newest-updated. `--epic` narrows to one epic.                        |
| `lore folio get <ref>` | One folio: its summary and Markdown content.                                            |
| `lore folio create`    | `--title`, `--summary`, `--content` (required, `@file` works); `--directory`, `--epic`. |

See [Folios](/lore/docs/guides-folios).

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

### Quality

`lore quality push` sends the coverage and test totals of the last run to the
project's **Quality** report. `--branch` files them under another branch than
the checked-out one. It expects an Alepha project.

### Apps and deploys

| Command              | What it does                                                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lore apps build`    | Build this app for one or more deploy targets.                                                                                                                                                              |
| `lore deploy`        | Deploy this app onto one of its environments. Without `--tag` it builds, pushes and deploys; with one it deploys that stored build. `--env`, `--app`, `--sigil` / `--no-sigil`. Same as `lore apps deploy`. |
| `lore apps redeploy` | Deploy a stored build onto every copy of the app whose environment ends with `--suffix`.                                                                                                                    |
| `lore apps destroy`  | Take a copy down: `--env` and `--confirm <app>/<env>` are both required.                                                                                                                                    |

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

| Command                     | What it does                                                     |
| --------------------------- | ---------------------------------------------------------------- |
| `lore artifacts push`       | Pack the current build and push it. `--tag`, `--app`, `--force`. |
| `lore artifacts push-image` | Record a container image CI pushed, by `--image` and `--digest`. |

See [Artifacts](/lore/docs/guides-artifacts).

### Estates

| Command                  | What it does                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `lore estate add <slug>` | Create a Bay estate, lend it to the project, and print the command to run on the machine. `--label`, `--allow-deploys`. |
| `lore estate list`       | The estates lent to the project, and whether each is connected.                                                         |

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

| Command                             | What it does                                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `lore stack create`                 | Create a stack with its default `--estate`, and upload its first revision from `--file`.                                         |
| `lore stack deploy`                 | Deploy to an environment (`-e`, default `production`), uploading `--file` as a new revision first.                               |
| `lore stack rollback`               | Deploy an earlier revision again. Volumes and their data are untouched.                                                          |
| `lore stack destroy`                | Forget an environment in Lore, and print the command that removes it from the machine.                                           |
| `lore stack list`                   | The project's stacks and their environments.                                                                                     |
| `lore stack revisions`              | A stack's revisions, newest first.                                                                                               |
| `lore stack secrets set/list/unset` | A stack environment's variables. `set` takes `KEY=VALUE`, `KEY` (read from `$KEY`), `--file`, or `--generate` for random values. |
| `lore stack route add/list/remove`  | Serve a full domain from one service.                                                                                            |
| `lore stack ps`                     | The services: state, memory, restarts and image digest.                                                                          |
| `lore stack logs <service>`         | The tail of one service's logs.                                                                                                  |
| `lore stack restart <service>`      | Restart one service.                                                                                                             |

`--name` picks the stack and defaults to the project slug. See
[Stacks](/lore/docs/guides-stacks) for Lore's side, and
[Stacks](/bay/docs/guides-stacks) in the Bay documentation for the file's format.
