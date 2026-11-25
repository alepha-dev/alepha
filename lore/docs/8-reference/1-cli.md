# The lore CLI

`lore` is Lore's command-line client. It signs in to an instance, reads and
writes a project's quests, epics, folios and feedback, and builds, pushes and
deploys apps from a laptop or a CI job. This page lists every command with the
flags it takes; `lore <command> --help` prints the same list with a sentence
for each flag.

## Install

```bash
npm i -g @alepha/lore
lore --help
lore --version
```

`lore --version` (or `-v`) prints the version alone, so
`VERSION=$(lore --version)` holds just the number.

A project that already depends on `@alepha/lore` can run `yarn lore ...`
without the global install.

## Signing in

| Where                    | How                                                                             |
| ------------------------ | ------------------------------------------------------------------------------- |
| A machine with a browser | `lore login`, then approve the code it prints. `lore logout` forgets the login. |
| CI, or anything headless | Set `LORE_API_KEY` to an API key.                                               |
| A self-hosted instance   | Set `LORE_URL` to its address, for both of the above.                           |

`LORE_API_KEY` wins over a stored login. With neither, a command fails and says
how to fix it: it never starts a login by itself, and `lore login` refuses to
run in CI, where nobody could approve the code.

See [how agents and the CLI connect](/lore/docs/agents-connecting) for where an
API key comes from, how long a login lasts and how to revoke one.

## Choosing the project

Every command that works inside a project looks for it in this order:

1. `--project <slug>` (or `-p`);
2. the `LORE_PROJECT` environment variable;
3. the nearest `.alepha/lore.json`, found by walking up from the current
   directory.

`.alepha/lore.json` is written by `lore project link <slug>` and
`lore project create <name>`, and holds one field:

```json
{ "project": "acme" }
```

## Conventions

- **Names follow the [MCP tools](/lore/docs/reference-mcp-tools).** The agent
  tool `quest_create` is `lore quest create`, and every tool has its command.
  Three subjects are plural here: `lore apps`, `lore artifacts` and
  `lore releases`. The CLI also does what no tool does: uploading a file,
  building and pushing an app, and managing secrets, hosts and registries.
- **Flags left out of the tables.** Every command that works inside a project
  takes `--project` (`-p`), and most take `--output`. The tables below list
  the others.
- **Output** is human-readable by default. `--output json` prints JSON for
  scripts on the commands whose `--help` lists it: the planning commands, the
  hosts and most reads, but not `lore deploy` or `lore secrets`, for
  instance. Logs go to standard error, so piping the output stays clean; a
  command that only logs, like `lore secrets list`, leaves standard output
  empty.
- **A delete needs `--yes`**, and refuses without it rather than prompting: a
  script has nothing to answer with. Five commands do ask in a terminal, and
  `--yes` answers for a script: `lore host rotate`, `move` and `delete`, and
  `lore stack destroy` and `delete`. `lore project delete` and
  `lore apps destroy` want a name typed again in `--confirm` instead.
- **Long text** (descriptions, folio content, comments, a rule's JSON) can be
  read from a file with `@file`, or from standard input with `@-`, on the flags
  whose help says so.
- **References.** A quest is `12`, `Q12` or `'#Q12'` (quoted, or the shell
  treats `#` as a comment). The same goes for an epic (`45`, `E45`), a folio
  (`F12`), a feedback item (`P120`), an error (`B12`), a directory (`D12`) and
  a folio's attachment (`A12`). The exceptions take the bare number:
  `--quest` and `--folio` on `lore attachments push`, and `--directory` on
  `lore folio create` and `update`.
- **Repeatable flags.** A flag marked _repeatable_ is passed once per value:
  `--tag bug --tag api`.
- **Exit codes.** `0` success, `1` failure (including a partial write), `3` not
  signed in, `4` not allowed. A credential Lore rejects (expired or revoked) is
  `3` and a refused permission is `4`, except on the build, push and
  release-job commands, which exit `1` for both: `lore deploy`,
  `lore apps build`, `redeploy` and `destroy`, `lore secrets`,
  `lore artifacts push` and `push-image`, `lore attachments push`,
  `lore quality push`, and `lore releases check`, `cut`, `publish` and
  `changelog` (without `--frozen`).

## Environment variables

| Variable       | What it does                                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `LORE_API_KEY` | The API key to authenticate with. Takes precedence over `lore login`.                                                             |
| `LORE_URL`     | The instance. Defaults to `https://lore.alepha.app`.                                                                              |
| `LORE_PROJECT` | The project, when `--project` is not given.                                                                                       |
| `LORE_APP`     | The app, for app commands, when `--app` is not given. Defaults to the name in `package.json`, slugified.                          |
| `LORE_ENV`     | The environment, for the deploy commands, when `--env` is not given. Without either, an app with exactly one environment uses it. |

## Projects

| Command                                 | What it does                                                                                                                 | Flags                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `lore project list`                     | The projects you are a member of, by slug.                                                                                   |                                                                |
| `lore project info`                     | One project: your rank and permissions in it, and its areas.                                                                 |                                                                |
| `lore project context`                  | Orient yourself: areas, your quests, open epics, releases, the folio index and the pinned folios.                            | `--all-epics`, `--limit` (folios indexed: default 30, max 200) |
| `lore project activity`                 | What happened since a timestamp, oldest first, your own events included.                                                     | `--since` (required), `--limit` (default and max 100)          |
| `lore project report [section]`         | One [Reports](/lore/docs/project-reports) section, always as JSON. `summary` by default.                                     | `--days` (the period, default 30)                              |
| `lore project create <name>`            | Create a project and link the current directory to it.                                                                       | `--no-link`                                                    |
| `lore project link <slug>`              | Link the current directory to an existing project.                                                                           | `--force` (replace a link to another project)                  |
| `lore project merge`                    | Merge one project into another, owners only. A dry run unless `--no-dry-run`: read the plan first. The source is left empty. | `--source`, `--target` (both required), `--no-dry-run`         |
| `lore project delete <slug>`            | Delete a project you own, with everything in it. This cannot be undone.                                                      | `--confirm <slug>` (required)                                  |
| `lore project capability list`          | Every capability, whether the project has it on, and each option.                                                            |                                                                |
| `lore project capability enable <key>`  | Turn a capability on, or change its options. Options not named keep their value. Owner only (`capability:manage`).           | `--option name` (on) or `--option name=false`, repeatable      |
| `lore project capability disable <key>` | Turn a capability off. Its data is hidden, never deleted. Owner only.                                                        |                                                                |

The sections of `lore project report` are `summary`, `flow`, `backlog`,
`planning`, `support`, `knowledge`, `delivery` and `team`.

`lore project create` makes a project with the **Ship**
capability only, its **Deploy apps** option on and **Track apps** off. Turn on
the rest with `lore project capability enable` or in the project's settings:
see [Capabilities](/lore/docs/project-capabilities).

`lore project delete` prints what goes with the project first (its quests,
folios and deployed copies), whether `--confirm` matches or not. There is no
`--yes`: the slug is typed twice. Nothing running on a host is stopped.

## Dashboards

A project's [dashboards](/lore/docs/project-dashboard) and their cards. Reading
needs membership; changing a dashboard needs `project:update`, as on the page.
Every command takes `--dashboard <id>`, as `lore dashboard list` prints it;
none means the project's first.

| Command                        | What it does                                                                                      | Flags                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lore dashboard list`          | The project's dashboards, in order.                                                               |                                                                                                                                                                          |
| `lore dashboard metrics`       | The metrics a card can show, the scopes each accepts, its default filters and what it needs.      |                                                                                                                                                                          |
| `lore dashboard cards`         | A dashboard's stored cards, in grid order. Empty while the first one shows the default dashboard. | `--dashboard`                                                                                                                                                            |
| `lore dashboard add <metric>`  | Add a card at the end of a dashboard, on the project unless a scope flag narrows it.              | `--app` (names or sigil ids, comma-separated), `--epic`, `--release`, `--viewer`, `--filters` (JSON), `--size` (1 to 6), `--height` (1 or 2), `--section`, `--dashboard` |
| `lore dashboard update <card>` | Change a card; what is not given is left alone.                                                   | `--metric`, and the flags of `add` but `--dashboard`                                                                                                                     |
| `lore dashboard remove <card>` | Remove a card.                                                                                    |                                                                                                                                                                          |
| `lore dashboard reorder <ids>` | Put a dashboard's cards in a new order: every card id, comma-separated.                           | `--dashboard`                                                                                                                                                            |

For example, a unique-visitors card for one app:
`lore dashboard add uniqueVisitors --app docs`.

## Quests

| Command                             | What it does                                                                                                        | Flags                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lore quest list`                   | Quests, newest-updated first. Shelved quests and the quests of draft epics are hidden unless asked.                 | `--status`, `--tag`, `--epic` (all repeatable), `--loose` (under no epic), `--search` (in titles), `--include-drafts`, `--limit` (default 20, max 100), `--offset`                                      |
| `lore quest get <ref>`              | One quest: its fields, description, objectives with their ids, and discussion.                                      |                                                                                                                                                                                                         |
| `lore quest create`                 | Create a quest, optionally filed into an epic and accepted in the same run.                                         | `--title`, `--area`, `--priority` (all required); `--description`, `--size`, `--tag`, `--objective` (both repeatable), `--epic`, `--accept`, `--depends-on`, `--due-at`, `--feedback`, `--release`      |
| `lore quest update <ref>`           | Change a quest.                                                                                                     | `--title`, `--description`, `--area`, `--priority`, `--size`, `--tag`, `--epic`, `--depends-on`, `--due-at`, `--objectives`, `--completion-message`, `--feedback`, `--release`, `--expected-updated-at` |
| `lore quest accept <ref>`           | Take the quest and start it: it is assigned to you.                                                                 |                                                                                                                                                                                                         |
| `lore quest objective set <ref>`    | Tick an objective of a quest in progress.                                                                           | `--objective <id>` (required), `--no-completed` (untick it)                                                                                                                                             |
| `lore quest comment add <ref>`      | Comment on a quest. An `@handle` reaches that member's inbox.                                                       | `--body` (required), `--as <name>` (marks it as written by an agent)                                                                                                                                    |
| `lore quest commit add <ref>`       | Record a commit on a quest, a completed one included.                                                               | `--sha` (required), `--message`, `--repo`                                                                                                                                                               |
| `lore quest pull-request add <ref>` | Record a pull request on a quest, a completed one included.                                                         | `--url` (required), `--pr-number`, `--repo`, `--title`                                                                                                                                                  |
| `lore quest hold <ref>`             | Put a quest on hold. The reason is posted to its discussion; with `--until` the hold lifts on its own on that date. | `--reason` (required), `--until`                                                                                                                                                                        |
| `lore quest unhold <ref>`           | Lift a hold: the quest gets its previous status back.                                                               |                                                                                                                                                                                                         |
| `lore quest shelve <ref>`           | Set a quest aside without deleting it; an accepted one is unassigned in the same step.                              |                                                                                                                                                                                                         |
| `lore quest unshelve <ref>`         | Bring a shelved quest back to the backlog.                                                                          |                                                                                                                                                                                                         |
| `lore quest unassign <ref>`         | Send an accepted quest back to todo.                                                                                |                                                                                                                                                                                                         |
| `lore quest reminder set <ref>`     | Set or clear your reminder on a quest you hold.                                                                     | `--interval` (`daily`, `weekly`, `monthly` or `off`)                                                                                                                                                    |
| `lore quest complete <ref>`         | Complete a quest in progress whose objectives are all ticked or waived.                                             | `--message`, `--commit <sha>`, `--waive <id>=<reason>` (both repeatable)                                                                                                                                |
| `lore quest delete <ref>`           | Delete a quest for good. To keep the record, shelve it.                                                             | `--yes` (required)                                                                                                                                                                                      |
| `lore quest tags`                   | The tags the project's quests use.                                                                                  |                                                                                                                                                                                                         |
| `lore area delete <name>`           | Delete an empty area by its exact name. One that holds quests is refused, with how many.                            |                                                                                                                                                                                                         |
| `lore quest attachment get <ref>`   | Read a file attached to a quest. Text is printed; `--out` saves anything.                                           | `--attachment <id>` (required, as `lore quest get` lists it), `--out <path>`                                                                                                                            |

Worth knowing about the values:

- `--status` is `todo`, `in_progress`, `on_hold`, `completed` or `shelved`.
- `--priority` is `optional`, `low`, `medium` or `high`. `--size` runs from `1`
  (XS) to `5` (XL) and defaults to `3`.
- `--waive` closes an objective that was **not** done, with the reason. An
  objective that was done is ticked with `lore quest objective set`.
- `--accept` on `lore quest create` that is refused leaves the quest created
  and exits `1`.

On `lore quest update`, a flag replaces what was there:

- `--tag` replaces the whole set: pass every tag to keep, or `'[]'` to clear
  them.
- `--objectives` takes the whole list as JSON, to reword or reorder it. Carry
  the id of each objective that survives.
- `--epic 0` takes the quest out of its epic, `--depends-on 0` clears the
  dependency and `--feedback 0` unlinks the feedback item.
- An empty string clears `--due-at`, `--completion-message` and `--release`.
- `--expected-updated-at` takes the `updatedAt` of your last read: an edit
  that landed since is refused rather than overwritten.

See [Quests](/lore/docs/plan-quests) for the statuses and rules behind these.

## Epics

| Command                            | What it does                                                                                          | Flags                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `lore epic list`                   | Every epic, whatever its status.                                                                      |                                                                                         |
| `lore epic get <ref>`              | One epic: status, progress, plan, pull requests, folios, open review blockers and questions, and log. |                                                                                         |
| `lore epic create`                 | Create an epic, as a draft: its quests stay out of the backlog until it is ready.                     | `--title` (required), `--description`, `--depends-on`                                   |
| `lore epic update <ref>`           | Change an epic's title, plan or predecessor.                                                          | `--title`, `--description`, `--depends-on` (`0` clears it)                              |
| `lore epic set status <ref>`       | Set an epic to draft or ready. The other statuses follow from its quests.                             | `--status draft` or `--status ready` (required)                                         |
| `lore epic shelve <ref>`           | Set an epic and its open quests aside.                                                                |                                                                                         |
| `lore epic unshelve <ref>`         | Bring a shelved epic back with the quests its shelving took: in progress if started, else a draft.    |                                                                                         |
| `lore epic delete <ref>`           | Delete a draft, ready or shelved epic **and every quest in it**, for good.                            | `--yes` (required)                                                                      |
| `lore epic review create <ref>`    | File a review of a draft or ready epic: its blockers, questions, decisions and changes.               | `--items` (required: a JSON array, usually `@file` or `@-`), `--summary`                |
| `lore epic review answer <ref>`    | Record the owner's answer to one review item.                                                         | `--item <number>` (required), then one of `--answer`, `--suggestion <index>`, `--waive` |
| `lore epic pull-request add <ref>` | Record a pull request on an epic, in any status. Its quests with none of their own show it.           | `--url` (required), `--pr-number`, `--repo`, `--title`                                  |

See [Epics](/lore/docs/plan-epics), and
[Reviewing an epic](/lore/docs/plan-epics#reviewing-an-epic) for what a review
holds.

## Releases

Every command names its release by `--tag` (`-t`), byte for byte.

Four commands serve a release job:

| Command                   | What it does                                                                                  | Flags                                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `lore releases check`     | Fail when the open release with this tag still has unfinished quests.                         | `--tag` (required)                                                                                                   |
| `lore releases changelog` | Print that release's changelog as Markdown.                                                   | `--tag` (required), `--frozen`                                                                                       |
| `lore releases cut`       | Bump `package.json`, prepend the notes to `CHANGELOG.md`, commit and tag. All of it is local. | `--bump major`, `minor` or `patch` (required), `--notes <file>`, `--env-file <file>` (appends `VERSION=x.y.z` to it) |
| `lore releases publish`   | Publish the release with this tag, when there is one.                                         | `--tag` (required), `--title`                                                                                        |

`lore releases changelog --frozen` prints a release's changelog as Lore holds
it, open or published. Without it the command serves a release job, and
refuses a published or incomplete release.

The others manage the release's own record:

| Command                     | What it does                                                                             | Flags                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `lore releases list`        | Every release, open and published.                                                       |                                                                                                |
| `lore releases get`         | One release, with the epics and quests attached to it.                                   | `--tag` (required)                                                                             |
| `lore releases create`      | Create a release. Several can be open at once, and a new one is never the default.       | `--tag` (required), `--title`, `--description`, `--target-date`                                |
| `lore releases update`      | Edit an open release.                                                                    | `--tag` (required), `--new-tag`, `--title`, `--description`, `--target-date` (empty clears it) |
| `lore releases attach`      | Put an epic or a quest in a release. An epic carries its quests.                         | `--tag` (required), `--epic` or `--quest`                                                      |
| `lore releases detach`      | Take an epic or a quest out. An epic takes the quests that followed it.                  | `--tag` (required), `--epic` or `--quest`                                                      |
| `lore releases set default` | Choose the release that work filed without one lands in. A published release is refused. | `--tag`, or `--clear`                                                                          |
| `lore releases delete`      | Delete a release. What is in it is detached, never deleted.                              | `--tag`, `--yes` (both required)                                                               |

Two of these lose something:

- `--new-tag` moves the release's URL and breaks every link already shared.
  There is no redirect.
- `lore releases delete` on a published release also deletes its frozen
  changelog and counts, which exist nowhere else.

See [Releases](/lore/docs/plan-releases) for how these fit in a release job.

## Folios

| Command                              | What it does                                                                | Flags                                                                                                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lore folio list`                    | Folios, pinned first, then newest-updated.                                  | `--epic`, `--search` (title or text), `--limit` (default 20, max 100), `--offset`                                                                                           |
| `lore folio search <query>`          | The folios that match, each with a snippet around the match.                | `--limit` (default 10, max 50)                                                                                                                                              |
| `lore folio get <ref>`               | One folio: its summary and Markdown content.                                | `--links` (what it references, and what references it)                                                                                                                      |
| `lore folio create`                  | Create a folio, optionally in a directory and under an epic.                | `--title`, `--summary` (required), `--content` (required for text, `@file` works); `--type table` with `--column Name:type` (repeated); `--directory`, `--epic`, `--pinned` |
| `lore folio update <ref>`            | Change a folio. Omitted flags stay as they are.                             | `--title`, `--summary`, `--content`, `--directory` (`0` is the root), `--pinned` / `--no-pinned`, `--epic` (`0` out)                                                        |
| `lore folio history <ref>`           | Its revisions, newest first. `--output json` carries their content.         |                                                                                                                                                                             |
| `lore folio revert <ref>`            | Put a folio back to a revision. What it replaces stays in the history.      | `--revision <id>` (required, from `lore folio history`)                                                                                                                     |
| `lore folio delete <ref>`            | Delete a folio for good.                                                    | `--yes` (required)                                                                                                                                                          |
| `lore folio row list <ref>`          | A table's rows, cells by column name.                                       | `--where` (JSON filters), `--sort`, `--direction`, `--limit` (default 20, max 100), `--offset`                                                                              |
| `lore folio row add <ref>`           | Add rows to a table.                                                        | `--rows` (required, JSON; `@file` and `@-` work)                                                                                                                            |
| `lore folio row update <ref>`        | Change some cells of one row.                                               | `--row` (required), `--cells` (required, JSON), `--version`                                                                                                                 |
| `lore folio row delete <ref>`        | Delete rows of a table by number.                                           | `--rows 3,5` (required), `--yes` (required)                                                                                                                                 |
| `lore folio column set <ref>`        | Change a table's columns, operations applied in order.                      | `--operations` (required, JSON)                                                                                                                                             |
| `lore folio import <file.csv>`       | Create a table from a CSV file, or add its rows to one.                     | `--into <ref>`, `--title`, `--summary`                                                                                                                                      |
| `lore folio export <ref>`            | Print a table as CSV.                                                       | `--csv` (required)                                                                                                                                                          |
| `lore folio attachment list <ref>`   | A folio's files, each with its number.                                      |                                                                                                                                                                             |
| `lore folio attachment rename <ref>` | Rename a file, named by its own number. A name already taken gets a suffix. | `--name` (required)                                                                                                                                                         |
| `lore folio attachment delete <ref>` | Delete a file, named by its own number, and reclaim its storage.            | `--yes` (required)                                                                                                                                                          |

A pinned folio's whole content opens every `lore project context`, so pin
sparingly.

See [Folios](/lore/docs/remember-folios).

## Directories

| Command                        | What it does                                                 | Flags                                  |
| ------------------------------ | ------------------------------------------------------------ | -------------------------------------- |
| `lore directory list`          | What a directory holds. The root by default.                 | `--directory <ref>`                    |
| `lore directory create <name>` | Create a directory. A name already taken gets a suffix.      | `--parent <ref>` (the root by default) |
| `lore directory rename <ref>`  | Rename a directory. A name already taken gets a suffix.      | `--name` (required)                    |
| `lore directory move <ref>`    | Move a directory under another, or to the root.              | `--parent <ref>` (the root without it) |
| `lore directory delete <ref>`  | Delete a directory. One that is not empty needs `--cascade`. | `--yes` (required), `--cascade`        |

`--cascade` also deletes everything the directory holds: its folios, their
attachments and its directories.

## Attachments

```bash
lore attachments push ./chart.png --quest 1208
lore attachments push ./notes.pdf --folio 12 --name "Meeting notes.pdf"
lore attachments push ./receipt.png --run 41 --criterion C2
```

`lore attachments push <file>` puts one file per call onto a quest, a folio or
a use case run.

| Flag                  | What it does                                                                 |
| --------------------- | ---------------------------------------------------------------------------- |
| `--quest` / `--folio` | The target, by its bare number. One of these or `--run`.                     |
| `--run`               | A use case run, by the id `lore usecase run record` prints.                  |
| `--criterion`         | With `--run`: the criterion the file shows, such as `C2`.                    |
| `--step`              | With `--run`: the scenario step the file shows.                              |
| `--name`              | The name to store the file under. Defaults to the file's name on disk.       |
| `--type`              | The media type, such as `text/html`. Defaults to a guess from the extension. |

A folio adds a suffix to a name it already holds, and the command prints the
name it stored. To read a file back, use `lore quest attachment get` or
`lore folio attachment list`. See
[Attachments](/lore/docs/remember-attachments).

## Feedback

| Command                              | What it does                                                                    | Flags                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `lore feedback list`                 | Feedback, newest first: the pending inbox unless `--status` says otherwise.     | `--status`, `--limit` (1 to 50, default 50), `--offset`                           |
| `lore feedback get <ref>`            | One item: its report, where it was made from, its files, quests and discussion. |                                                                                   |
| `lore feedback attachment get <ref>` | Read a file of an item or of one of its comments. Text is printed.              | `--attachment <id>` (required, as `lore feedback get` lists it), `--out`          |
| `lore feedback comment add <ref>`    | Comment on an item. The reporter is told, and can answer.                       | `--body` (required), `--as <name>` (marks it as written by an agent)              |
| `lore feedback accept <ref>`         | Accept a pending item: the request is valid.                                    |                                                                                   |
| `lore feedback reject <ref>`         | Reject a pending item. The item stays, for the record.                          |                                                                                   |
| `lore feedback targets`              | The projects you belong to that accept feedback: where `submit` can file.       |                                                                                   |
| `lore feedback submit`               | File a feedback item, pending in the project's inbox.                           | `--title`, `--description` (both required), `--type`, `--tags a,b`, `--as <name>` |

`--status` is `pending`, `accepted`, `rejected` or `all`. Accepting creates no
quest: file one with `lore quest create --feedback <ref>`.

See [Feedback](/lore/docs/plan-feedback).

## Personas, use cases and requirements

The commands of Plan's Requirements option. See [Personas](/lore/docs/plan-personas),
[Use cases](/lore/docs/plan-use-cases), [Requirements](/lore/docs/plan-requirements),
[Verify and runs](/lore/docs/plan-verify) and [Traceability](/lore/docs/plan-traceability).

| Command                              | What it does                                                                     | Flags                                                                                                                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lore persona list`                  | A project's personas.                                                            | `--kind`                                                                                                                                                                            |
| `lore persona get <ref>`             | One persona: who they are, their goals, their demo account and their discussion. |                                                                                                                                                                                     |
| `lore persona create`                | Create a persona, numbered `A<n>`.                                               | `--name` (required), `--kind`, `--role`, `--who`, `--goals`, `--frustrations`, `--alepha-role`, `--demo-account`, `--demo-seed`, `--environment-app`, `--environment-env`, `--area` |
| `lore persona update <ref>`          | Change a persona; omitted flags stay as they are.                                | as `create`                                                                                                                                                                         |
| `lore persona delete <ref>`          | Delete a persona; its number is never reused.                                    |                                                                                                                                                                                     |
| `lore persona comment add <ref>`     | Comment on a persona.                                                            | `--body` (required)                                                                                                                                                                 |
| `lore usecase list`                  | A project's use cases.                                                           | `--status`                                                                                                                                                                          |
| `lore usecase get <ref>`             | One use case: actors, steps, alternatives, criteria and covering epics.          |                                                                                                                                                                                     |
| `lore usecase create`                | Create a use case, as a draft.                                                   | `--title` (required), `--actor`, `--step`, `--alternative`, `--criteria`, `--priority`, `--preconditions`                                                                           |
| `lore usecase update <ref>`          | Change a use case; each list given replaces its own.                             | as `create`, `--status`                                                                                                                                                             |
| `lore usecase delete <ref>`          | Delete a use case; its number is never reused.                                   |                                                                                                                                                                                     |
| `lore usecase comment add <ref>`     | Comment on a use case.                                                           | `--body` (required)                                                                                                                                                                 |
| `lore usecase link epic <ref>`       | Make an epic cover a use case, or stop with `--no-linked`.                       | `--epic` (required), `--linked`                                                                                                                                                     |
| `lore usecase validate <ref>`        | Answer a use case's validation.                                                  | `--decision` (`validated` or `changes_requested`), `--note`                                                                                                                         |
| `lore usecase run record <ref>`      | Record a run: one result per criterion, where it ran, and a note.                | `--result` (`C1=passed,C2=failed:why`), `--by`, `--client`, `--app`, `--env`, `--note`                                                                                              |
| `lore usecase prompt [ref]`          | Print the Verify prompt.                                                         | `--mode` (`test`, `spec`, `demo`, `explore`, `import`, `draft`), `--persona`, `--folio`, `--requirement`, `--epic`, `--stale`, `--app`, `--env`, `--as`                             |
| `lore requirement list`              | A project's requirements.                                                        | `--type`, `--priority`                                                                                                                                                              |
| `lore requirement get <ref>`         | One requirement: its criteria, covering epics, release, status and measure.      |                                                                                                                                                                                     |
| `lore requirement create`            | Create a requirement, numbered `S<n>`.                                           | `--statement` (required), `--type`, `--priority`, `--chapter`, `--paragraph`, `--source-folio`, `--source-anchor`, `--metric-*`                                                     |
| `lore requirement update <ref>`      | Change a requirement; omitted flags stay as they are.                            | as `create`, `--metric-clear`                                                                                                                                                       |
| `lore requirement delete <ref>`      | Delete a requirement; its number is never reused.                                |                                                                                                                                                                                     |
| `lore requirement set release <ref>` | Set the release a requirement ships in; its covering epics move with it.         | `--release` (required), `--confirm`                                                                                                                                                 |
| `lore requirement coverage`          | A release's readiness and the coverage gaps, or the whole project's.             | `--release`                                                                                                                                                                         |
| `lore criterion link`                | Say which requirement a use case's criterion verifies.                           | `--usecase`, `--key`, `--requirement` (empty to unlink)                                                                                                                             |

A measure takes `--metric-kind` (`vital`, `availability`, `latency` or `api`),
`--metric-threshold`, and as it needs `--metric-vital`, `--metric-percentile`,
`--metric-path`, `--metric-method`, `--metric-monitor`, `--metric-app`,
`--metric-env` and `--metric-window-days`. Run evidence is pushed with
`lore attachments push --run <id> [--criterion C2 | --step 3] <file>`.

## Chat

A project's chat rooms, for a script or a coding agent that reports into a
room. A private room you are not in does not exist here, as in the app.
`@name` in a message notifies that member; `@lore`, or a project agent's
handle, asks that agent, which answers in the room with your rights.

| Command                                | What it does                                                          | Flags                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `lore chat room list`                  | The rooms you can see, open and private, with what is unread in each. |                                                                                                                |
| `lore chat message list <room>`        | A room's latest messages, newest first.                               | `--before <message id>`, `--limit` (1 to 100)                                                                  |
| `lore chat message send <room> <text>` | Post a message as you.                                                |                                                                                                                |
| `lore chat agent list`                 | The agents a message can mention: `lore` and the project's own.       |                                                                                                                |
| `lore chat agent get <handle>`         | One agent, its persona and playbook included.                         |                                                                                                                |
| `lore chat agent create`               | Create an agent (Chat agents permission).                             | `--handle`, `--name`, `--pre-prompt` (text, `@file.md` or `@-` for stdin), `--model`, `--avatar <image>`       |
| `lore chat agent update <handle>`      | Edit an agent: only the flags given change.                           | `--new-handle`, `--name`, `--pre-prompt`, `--model` (empty for the default), `--avatar <image>`, `--no-avatar` |
| `lore chat agent delete <handle>`      | Delete an agent: its past answers stay, its handle is freed.          |                                                                                                                |

## Notifications

Who is told when something changes in a project, and your own inbox. A
channel's URL is its credential: `lore channel` reads it from stdin with
`--url-stdin`, never from a flag, so it does not land in a shell history, and
prints a webhook's signing secret once. See
[Notifications](/lore/docs/project-notifications).

| Command                      | What it does                                                                                                       | Flags                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lore event catalog`         | The events this project can emit, with what each needs and why an unavailable one is so.                           |                                                                                                                                                                 |
| `lore event list`            | The recent events, newest first, to check that one fired.                                                          | `--name`, `--subject`, `--limit` (1 to 100), `--offset`                                                                                                         |
| `lore subscription list`     | Who is notified of what, on which channel, and the project's channels (never a URL).                               |                                                                                                                                                                 |
| `lore subscription set [id]` | Notify a member (you by default) or a channel of an event, or mute, unmute or remove a row.                        | `--event`, `--filter`, `--member`, `--channel`, `--channels`, `--not-mine`, `--not-members`, `--verb`                                                           |
| `lore channel list`          | The project's channels: Inbox, Email, then its Discord and webhook channels.                                       |                                                                                                                                                                 |
| `lore channel add`           | Add a Discord or webhook channel, the URL from stdin (a webhook's signing secret is printed once), or a chat room. | `--kind` (`discord`, `webhook` or `chat`), `--name` (required except with `chat`, whose channel is named after its room), `--url-stdin`, `--room` (with `chat`) |
| `lore channel update <id>`   | Rename a channel, or replace its URL from stdin.                                                                   | `--name`, `--url-stdin`                                                                                                                                         |
| `lore channel delete <id>`   | Delete a channel and every notification sent to it.                                                                | `--yes` (required)                                                                                                                                              |
| `lore channel rotate <id>`   | Give a webhook channel a new signing secret, printed once; the old one signs for 24 more hours.                    |                                                                                                                                                                 |
| `lore threshold get`         | The coverage and open-errors alert thresholds.                                                                     |                                                                                                                                                                 |
| `lore threshold set`         | Set or clear a threshold; `none` clears one.                                                                       | `--coverage-min`, `--open-errors-max`                                                                                                                           |
| `lore inbox list`            | Your inbox, newest first, across every project unless one is named.                                                | `--project`, `--unread`, `--limit` (1 to 100), `--cursor`                                                                                                       |
| `lore inbox read [id]`       | Mark one message read, or all of them.                                                                             | `--all`, `--project`                                                                                                                                            |
| `lore notifications get`     | Your notification preferences: email on or off, and the kinds you muted.                                           |                                                                                                                                                                 |
| `lore notifications set`     | Turn email on or off, mute or unmute kinds of message. Needs `lore login`: an API key is refused.                  | `--email` (`on` or `off`), `--mute`, `--unmute`                                                                                                                 |

## Errors and insights

| Command                    | What it does                                                                                      | Flags                               |
| -------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `lore error list`          | The inbox: one row per root cause, most widespread first. Open ones only by default.              | `--include-resolved`                |
| `lore error resolve <ref>` | Close an error for good. A later report raises its count and never reopens it.                    |                                     |
| `lore error forward <ref>` | Turn an error into a new quest and close it, or link a quest already filed. One error, one quest. | `--quest`                           |
| `lore insights read`       | Analytics, Web Vitals and the error budget of each app.                                           | `--range`, `--segment`, `--traffic` |

Before resolving an error, check `lore insights read --segment errors`: it is
what says whether the failure is still happening.

| Flag        | Values                                                                       |
| ----------- | ---------------------------------------------------------------------------- |
| `--range`   | `1d`, `7d` (the default) or `30d`.                                           |
| `--segment` | `errors`, `vitals`, `analytics`. Repeatable; all three by default.           |
| `--traffic` | `all` (the default), `humans` or `bots`. It narrows analytics, never errors. |

See [Telemetry](/lore/docs/ship-telemetry).

## Quality

`lore quality push` sends the coverage and test totals of the last run to the
project's **Quality** report. It reads `coverage/coverage-summary.json` and
`coverage/test-results.json`, the two files `alepha test --coverage` writes.
`--branch` files the run under another branch than the checked-out one. See
[Quality](/lore/docs/project-quality).

## Apps and deploys

These commands build and deploy the app in the current directory, which has to
be an app built with the Alepha framework. A [stack](#stacks) deploys any
Compose file.

| Command                | What it does                                                                                                                        | Flags                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `lore apps build`      | Build this app for one or more deploy targets.                                                                                      | `--target` (several separated by commas), `--env`, `--tag`, `--app`  |
| `lore deploy`          | Deploy this app onto one of its environments. Without `--tag` it builds, pushes and deploys; with one it deploys that stored build. | `--tag`, `--env`, `--app`, `--sigil` / `--no-sigil`, `--domain`      |
| `lore apps deploy`     | The same command as `lore deploy`.                                                                                                  | The same                                                             |
| `lore apps redeploy`   | Deploy a stored build onto every copy of the app whose environment ends with `--suffix`. It never builds.                           | `--suffix` (required), `--tag` (default `latest`), `--app`           |
| `lore apps destroy`    | Take a copy down: its Worker, queue and cache are deleted, or it is removed from its Bay. The data is kept.                         | `--env`, `--confirm <app>/<env>` (both required), `--purge`, `--app` |
| `lore deploy status`   | Where a run got to, and the tail of its log.                                                                                        | `--deployment <id>`, or `--app` with `--env` for a copy's newest run |
| `lore deploy rollback` | Point a copy back at a run that succeeded. The code goes back, never the database.                                                  | `--deployment <id>` (required), `--acknowledge-migrations`           |

- `--app` defaults to `LORE_APP`, then to the name in `package.json`.
- `--env` on `lore deploy` falls back to `LORE_ENV`, then to the app's
  environment when it has exactly one. `lore apps destroy` never guesses it.
- `--env` on `lore apps build` builds what that environment can run.
- `--suffix` starts with a dash, so write it with `=`: `--suffix=-staging`.
- `--sigil` forces a sigil for the copy and stores its key in the copy's
  environment. A build that declares `SIGIL_KEY` gets one without the flag.
- `lore apps destroy` keeps the copy's data, with one exception: a copy
  created as ephemeral on Cloudflare loses its database and its bucket too.
- `--purge` is for a copy on a Bay whose data should go as well. Lore never
  asks a machine to delete data: the flag sends nothing, and prints the
  `bay remove --purge` command to run on the machine.
- `--acknowledge-migrations` is required when that build will not fit the
  current schema (the refusal names each change), or, when its schema is
  unknown, when migrations landed since that run.

See [Deploying an app](/lore/docs/ship-deploying) for the whole flow.

## App instances

An instance is one deployed copy of an app, named by `--app` and `--env`. Both
are required on every command here but `list`: neither is ever guessed. See
[Apps and instances](/lore/docs/ship-instances).

| Command                     | What it does                                                                | Flags                                                                                            |
| --------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `lore apps instance list`   | Every copy this project tracks.                                             |                                                                                                  |
| `lore apps instance get`    | One copy, with what it has unlocked.                                        | `--app`, `--env`                                                                                 |
| `lore apps instance create` | Track a copy. Nothing is minted: `lore sigil create` adds its key.          | `--app`, `--env`, `--url`, `--ephemeral`, `--host <slug>`                                        |
| `lore apps instance update` | Rename either half, pin the address, or point the copy at a host.           | `--app`, `--env`, `--new-app`, `--new-env`, `--url`, `--host <slug>` or `--host-id` (`0` clears) |
| `lore apps instance delete` | Forget a copy, its sigil and everything it reported. This cannot be undone. | `--app`, `--env`, `--yes` (required)                                                             |

`lore apps instance delete` undeploys nothing, and is refused while the copy
still runs: take it down with `lore apps destroy` first. `--host` names an
host lent to the project; pass it or `--host-id`, not both. An empty
`--url` clears the pinned address.

## Sigils

A sigil is the key one copy reports its telemetry with. See
[Telemetry](/lore/docs/ship-telemetry).

| Command                  | What it does                                                         | Flags                                              |
| ------------------------ | -------------------------------------------------------------------- | -------------------------------------------------- |
| `lore sigil list`        | Every sigil, with its copy and when it last reported. Never a token. |                                                    |
| `lore sigil create`      | Mint the key for one copy, creating the copy if it is missing.       | `--app` (required), `--env` (default `production`) |
| `lore sigil rotate <id>` | Replace a sigil's token and keep everything it reported.             |                                                    |
| `lore sigil delete <id>` | Delete a sigil and that copy's analytics. This cannot be undone.     | `--yes` (required)                                 |

`create` and `rotate` print the token once, and nothing can show it again. To
revoke a leaked token, use `rotate`: `delete` throws the history away.

## Monitors

A monitor checks one target on an interval, or waits for a job to push, and
belongs to one app copy. See [Healthchecks](/lore/docs/ship-healthchecks). A
monitor is named by its id, as `lore monitor list` prints it, so only `list`
and `create` take `--project`.

| Command                    | What it does                                                                    | Flags                                                          |
| -------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `lore monitor list`        | Every monitor, down first, with its status and uptime.                          | `--window` (`24h`, `7d`, `30d`)                                |
| `lore monitor get <id>`    | One monitor: settings, uptime over 24h, 7d and 30d, incidents, its last checks. |                                                                |
| `lore monitor create`      | Add a monitor to an app copy. A push monitor's token is printed once.           | `--app`, `--env`, `--name`, `--kind`, `--target`, the settings |
| `lore monitor update <id>` | Change the settings passed, and keep the rest.                                  | The settings                                                   |
| `lore monitor pause <id>`  | Stop its checks, keeping its history.                                           |                                                                |
| `lore monitor resume <id>` | Start its checks again.                                                         |                                                                |
| `lore monitor delete <id>` | Remove it with its checks and incidents. This cannot be undone.                 | `--yes` (required)                                             |

| Setting               | Values                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `--app`, `--env`      | The app copy the monitor belongs to, on `create`. An `http` monitor checks its address unless `--target` is given. |
| `--kind`              | `http`, `tcp` (host:port), `cert` (a certificate's expiry at host:port) or `push`.                                 |
| `--interval-secs`     | Seconds between checks, a multiple of 60. For a push monitor, the longest gap.                                     |
| `--timeout-secs`      | Seconds before a check gives up, 1 to 30.                                                                          |
| `--confirmations`     | Failed checks in a row before the monitor goes down.                                                               |
| `--expect-status`     | The HTTP status a passing check answers.                                                                           |
| `--keyword`           | Text a passing check's body contains.                                                                              |
| `--latency-budget`    | Milliseconds over which a check counts as failed.                                                                  |
| `--cert-warning-days` | Days before a certificate's expiry that count as failing.                                                          |

```bash
lore monitor create --app acme --env production --name Website --kind http --expect-status 200
lore monitor create --app backups --env production --name "Nightly backup" --kind push --interval-secs 86400
```

## Secrets

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

`--file` (`-f`) sets every key of a dotenv file, `SIGIL_KEY` aside. `--app`
names another app than the current directory's.

## Artifacts

| Command                     | What it does                                                     | Flags                                                                   |
| --------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `lore artifacts push`       | Pack the current build and push it.                              | `--tag` (default `latest`), `--app`, `--force`                          |
| `lore artifacts push-image` | Record a container image that CI pushed, by reference.           | `--image`, `--digest`, `--tag` (default `latest`), `--app`, `--force`   |
| `lore artifacts list`       | What the project has built, newest push first, one line per tag. | `--app`, `--tag`, `--limit`                                             |
| `lore artifacts get`        | One tag's builds: runtimes, formats, sizes, digests and commits. | `--app`, `--tag` (both required), `--runtime`, `--format`, `--manifest` |

`latest` is the one tag that may be replaced. `--force` moves any other tag
that already holds different bytes, or names a different image. `--digest` is
checked: the push is refused if the registry reports another one. An image on
`ghcr.io` is read anonymously; any other registry needs the project's
credential first, see [Container registries](#container-registries).
`--format` is `archive` or `image`.

See [Artifacts](/lore/docs/ship-artifacts).

## Hosts

A host is a machine a project deploys onto.

| Command                    | What it does                                                                                                  | Flags                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `lore host provision`      | Buy a server from a cloud provider, install Bay on it, enrol it as a host and wait until it is online.        | `--provider`, `--project` (required), `--name`, `--type`, `--zone`, `--no-allow-deploys`, `--timeout`                                        |
| `lore host add <slug>`     | Create a Bay host in the project, lend it there, and print the command to run on the machine.                 | `--label`, `--allow-deploys`, `--ttl`, `--stats-history`, `--stats-interval`                                                                 |
| `lore host list`           | The hosts the project can deploy onto: home or borrowed, connected or not, with current CPU and memory.       |                                                                                                                                              |
| `lore host get <slug>`     | One host: home project, online or not, last seen, deploys, the projects it is lent to, what the machine runs. | `--home`                                                                                                                                     |
| `lore host wait <slug>`    | Block until a host is online. Exits `1` on timeout, with the last state seen.                                 | `--timeout` (seconds, default 120), `--home`                                                                                                 |
| `lore host stats <slug>`   | A host's CPU and memory: the current reading, then one mean per day.                                          | `--since` (an ISO date, default 30 days ago), `--home`                                                                                       |
| `lore host lend <slug>`    | Lend a host to `--project`, so its apps can deploy there. Needs `host:lend` in both projects.                 | `--home`                                                                                                                                     |
| `lore host unlend <slug>`  | Withdraw a host's loan to `--project`. Refused while a copy there still deploys to it, naming the copies.     | `--home`                                                                                                                                     |
| `lore host update <slug>`  | Change whether a host accepts deploys, its label, its expiry or its stats.                                    | `--allow-deploys` / `--no-allow-deploys`, `--label` (empty clears it), `--ttl`, `--stats-history` / `--no-stats-history`, `--stats-interval` |
| `lore host upgrade <slug>` | Upgrade the Bay a host runs, and wait until the new version serves. Never to an older version.                | `--version` (x.y.z, default the release Lore runs), `--no-wait`, `--timeout` (seconds, default 360)                                          |
| `lore host rotate <slug>`  | Mint a new secret for a Bay host and print the connector command once.                                        | `--yes`                                                                                                                                      |
| `lore host move <slug>`    | Move a host to another project. Its slug, its machine and its loans stay.                                     | `--to` (required), `--yes`                                                                                                                   |
| `lore host assign <id>`    | For an instance admin: give a host a home project, by its id. Its loans do not change.                        | `--to` (required)                                                                                                                            |
| `lore host delete <slug>`  | Delete a host the project is the home of, never one it only borrows.                                          | `--yes`, `--keep-server`                                                                                                                     |

**Provisioning.** `--provider scaleway` buys the server through the provider's
own CLI: it needs `scw` installed and `scw login` done. Without `--provider`
the command lists the providers and what each needs. `--project` is the project
the host belongs to, created with the **Ship** capability
when it does not exist; a project that has it off is refused before anything is
bought. `--name` defaults to three random words, `--type` and `--zone` to the
provider's, and `--timeout` to 300 seconds. A provisioned host accepts
deploys unless `--no-allow-deploys`.

**Adding a machine by hand.** `lore host add` leaves deploys off unless
`--allow-deploys`: a new machine reports stats only until someone who manages
it says otherwise. With `--output json` it prints `id`, `slug`,
`deployAllowed`, `lore`, `secret` and `command`, so a script can read
`.secret`. `lore host rotate` prints the same shape, and the old secret stops
working at once.

**Expiry.** `--ttl` takes a duration such as `30m`, `2h` or `3d`. Past it the
host shows as overdue and you are told once; Lore stops nothing. On
`lore host update`, `--ttl` counts from now and `--ttl none` clears it.

**Stats.** `--stats-history` keeps a history of CPU and memory, as the switch
on the host's **Settings** tab does, and `--no-stats-history` stops it.
`--stats-interval` sets how often the machine reports them, in the `--ttl`
grammar, from `5m` to `1d`. Both work on `lore host add`, so one command sets
up a monitored host.

**Deleting.** `lore host delete` is refused while an app, a stack or a stack
environment deploys to the host. A provisioned host's server is terminated
with its IP and its disk; `--keep-server` leaves it running, and billing. For
a machine added by hand, Lore forgets it and nothing on it stops.

**Which host a slug means.** A slug is unique inside a home project. A
managing verb (`update`, `rotate`, `move`, `delete`) resolves it among the
hosts the project is the home of; a reading verb (`get`, `wait`, `stats`) and
`lend` among the hosts you can read, and `--home <project>` picks one when
two share the slug.

See [Hosts](/lore/docs/project-hosts).

## Prompts

A prompt is what Lore hands a coding agent: copied, or run on one of the
project's Agent hosts. See [Prompts](/lore/docs/agents-prompts). Every `lore
prompt` command and `lore agent hosts` need the Prompts capability on in the
project.

| Command                        | What it does                                                                                     | Flags                                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lore prompt list`             | The project's prompts: built-in then its own, with args, source, trigger, pins and last run.     |                                                                                                                                                                               |
| `lore prompt get <name>`       | One prompt, its words included.                                                                  |                                                                                                                                                                               |
| `lore prompt create <name>`    | A custom prompt.                                                                                 | `--text` (required, `@file` or `@-`), `--title`, `--description`, `--arg name:type[:status\|status]`, `--source`, `--ref`, `--timeout-seconds`, `--concurrency queue\|unique` |
| `lore prompt update <name>`    | Change the flags given: a custom prompt's words and args, any prompt's source and where it runs. | the same, `--host`, `--agent`, `--model`, `--enabled`, `--on`, `--check`, `--set`, `--max-per-hour`, `--max-per-day`, `--pin`                                                 |
| `lore prompt duplicate <name>` | Copy any prompt into a custom one.                                                               | `--new-name` (required), `--title`                                                                                                                                            |
| `lore prompt delete <name>`    | Delete a custom prompt; its jobs stay.                                                           |                                                                                                                                                                               |
| `lore prompt render <name>`    | Print its words with its args filled.                                                            | `--epic`, `--quest`, `--feedback`, `--pr`, `--member`, `--set arg=reference`                                                                                                  |
| `lore prompt run <name>`       | Run it on an Agent host; prints the job and its page, or the job it is queued behind.            | the same, `--host`, `--agent`, `--model`, `--fix`, `--trust`, `--continue <job>`, `--wait`                                                                                    |
| `lore prompt trigger <name>`   | When it runs on its own.                                                                         | `--on`, `--check`, `--set`, `--max-per-hour`, `--max-per-day`                                                                                                                 |
| `lore prompt pin <name>`       | Pin it to pages.                                                                                 | `--on` (required: quests, quest, epics, epic, feedback, feedback-item, errors, and with Requirements use-cases, use-case, persona, requirement)                               |
| `lore prompt unpin <name>`     | Unpin it from pages, or from every page.                                                         | `--on`                                                                                                                                                                        |
| `lore prompt enable <name>`    | Turn its trigger on.                                                                             |                                                                                                                                                                               |
| `lore prompt disable <name>`   | Turn its trigger off; a run by hand still works.                                                 |                                                                                                                                                                               |
| `lore prompt pause-all`        | Stop every trigger of the project.                                                               |                                                                                                                                                                               |
| `lore prompt resume-all`       | Start them again.                                                                                |                                                                                                                                                                               |

`--on` is `manual`, `event:<key>[,<key>]` (the keys of `lore event catalog`),
`hourly`, `6h`, `daily@<hour>` or `weekly@<day>@<hour>`, hours in UTC, or an
event part and a schedule part joined by a comma. A run takes no source: it is
set on the prompt. `--wait` follows the job's log and exits with `1` when it
does not succeed.

## Agent jobs

An agent job is a prompt run on one of the project's Agent hosts. The `lore
job` commands work whatever the capabilities: a job's history outlives the
switch.

| Command                | What it does                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `lore agent hosts`     | The project's Agent hosts: each one's last check, its agent CLIs and the tools its jobs user has.                                    |
| `lore job list`        | The project's jobs, newest first.                                                                                                    |
| `lore job get <id>`    | One job: its prompt, args and cause, what it ran (agent, model, workspace, source, ref, branch, commit), how it ended and its reply. |
| `lore job logs <id>`   | A job's output.                                                                                                                      |
| `lore job cancel <id>` | Stop a job.                                                                                                                          |

See [Agent jobs](/lore/docs/agents-jobs).

## Commits

| Command             | What it does                                                            | Flags                                       |
| ------------------- | ----------------------------------------------------------------------- | ------------------------------------------- |
| `lore commits push` | Record the quests the current commit's history names, with no artifact. | `--branch`, `--default-branch`, `--project` |

A project that does not deploy through Lore runs it on every push of its
default branch, so each quest shows the commits that reached it. In GitHub
Actions, after a checkout with its history
(`fetch-depth: 0`) and with `LORE_API_KEY` set:

```yaml
- run: npx @alepha/lore commits push --project acme
```

The branch comes from `GITHUB_REF_NAME`, the default branch from the event's
repository; elsewhere from git, and `main` when nothing names it. A project
that deploys through Lore needs nothing more: `lore artifacts push` records the
same quests.

## Container registries

A project stores one credential per registry host. Private images are pulled
with it: by `lore artifacts push-image` to verify them, and by the host at
deploy.

| Command                       | What it does                                   | Flags                                                                        |
| ----------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `lore registry add <host>`    | Store the project's credential for a registry. | `--username` (`-u`, required), then `--password-stdin` or `--password @file` |
| `lore registry list`          | Hosts and usernames, never a secret.           |                                                                              |
| `lore registry remove <host>` | Forget the credential.                         |                                                                              |

The token is never typed inline: it comes from standard input
(`--password-stdin`, as `docker login` does) or from a file (`--password
@file`).

## Stacks

A stack is a group of apps and services deployed together from one
`compose.yml` onto a Bay host. `--name` picks the stack and defaults to the
project slug. `--env` (`-e`) picks the environment.

| Command                              | What it does                                                                                           | Flags                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `lore stack create`                  | Create a stack with its default host, and upload its first revision.                                   | `--file` (`-f`), `--host`                                                                       |
| `lore stack deploy`                  | Deploy to an environment, `production` by default, uploading the compose file as a new revision first. | `--env`, `--file`, `--revision`, `--host`, `--app` with `--tag`, `--test-hostname`, `--dry-run` |
| `lore stack rollback`                | Deploy an earlier revision again. Volumes and their data are untouched.                                | `--env`, `--to <revision>` (both required)                                                      |
| `lore stack destroy`                 | Remove an environment from its Bay, its volumes kept, then forget it in Lore.                          | `--env` (required), `--purge`, `--yes`                                                          |
| `lore stack delete [name]`           | Delete a stack with no environment left, with its routes and revisions.                                | `--yes`                                                                                         |
| `lore stack list`                    | The project's stacks and their environments.                                                           |                                                                                                 |
| `lore stack get`                     | One stack: each environment's routes, members, services and newest deploys. Never a variable's value.  | `--env` (only this environment)                                                                 |
| `lore stack revisions`               | A stack's revisions, newest first.                                                                     |                                                                                                 |
| `lore stack secrets set [KEY=VALUE]` | Set a variable of an environment: `KEY=VALUE`, or `KEY` to read `$KEY`.                                | `--env` (required), `--file` (a dotenv file), `--generate`, `--length`                          |
| `lore stack secrets list`            | An environment's variables: names and masks, never a value.                                            | `--env` (required)                                                                              |
| `lore stack secrets unset <KEY>`     | Remove one variable.                                                                                   | `--env` (required)                                                                              |
| `lore stack route add <service>`     | Serve a full domain from one service of an environment.                                                | `--env`, `--domain` (`-d`) (both required)                                                      |
| `lore stack route list`              | An environment's routes.                                                                               | `--env` (default `production`)                                                                  |
| `lore stack route remove <domain>`   | Stop serving a domain.                                                                                 | `--env` (required)                                                                              |
| `lore stack ps`                      | The services: state, memory, restarts and the image digest each runs.                                  | `--env` (default `production`)                                                                  |
| `lore stack logs <service>`          | The tail of one service's logs, asked of the machine.                                                  | `--env` (default `production`), `--lines` (default 200, max 2000)                               |
| `lore stack restart <service>`       | Restart one service.                                                                                   | `--env` (default `production`)                                                                  |

On `lore stack deploy`:

- An environment is created on its first deploy. `--host` then picks its
  host instead of the stack's default.
- `--revision` deploys that revision instead of the newest. Without it or
  `--file`, the compose file in the current directory is uploaded.
- `--app` deploys one member app alone, blue/green, from a stored build.
  `--tag` names the build and defaults to `latest`.
- `--test-hostname <service>` also serves that service on
  `<env>-<stack>.<ip>.sslip.io`: HTTPS with no DNS to set up.
- `--dry-run` says what would happen and changes nothing.

`lore stack secrets set --generate` makes a random value on the server for the
key you name; `--length` sets its size in hex characters, 16 to 256, 64 by
default.

`lore stack destroy --purge` is for an environment whose volumes should go as
well. Lore never asks a machine to delete data: it forgets the environment and
prints the `bay stack destroy --purge` command to run on the machine.
`lore stack delete` is refused while an environment remains, and changes
nothing on a machine.

See [Stacks](/lore/docs/ship-stacks) for Lore's side, and
[Stacks](/bay/docs/guides-stacks) in the Bay documentation for the file's
format.

## Next

- [How agents and the CLI connect](/lore/docs/agents-connecting)
- [MCP tools](/lore/docs/reference-mcp-tools)
- [Deploying an app](/lore/docs/ship-deploying)
- [Quests](/lore/docs/plan-quests)
