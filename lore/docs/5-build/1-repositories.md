# Repositories

A project can hold its git repositories on Lore. You clone and push them with
plain git over HTTPS, and the `lore` command answers git when it asks who you
are, so nobody copies a token by hand. A new project can live on Lore with no
other git host; an existing repository can move in, or be copied in from
GitHub and kept up to date.

Repositories need the **Build** capability with its **Repositories** option
on, both switched in **Settings ▸ General ▸ Capabilities**. See
[Capabilities](/lore/docs/project-capabilities). With them on, **Code** joins
the sidebar, in Build's group beside **Quality**.

## Creating a repository

Only a project **Admin** creates or deletes a repository. From a shell signed
in with `lore login`:

```bash
lore code repo create api
```

The repository is empty, and its default branch is `main` unless
`--default-branch` names another. `lore code repo list` prints every
repository of the project with its clone URL:

```txt
https://<instance>/<project>/<repo>.git
```

A repository named like its project is also reachable as
`https://<instance>/<project>.git`.

## Cloning and pushing

```bash
lore clone acme/api
cd api
git push
```

`lore clone <project>[/<repo>]` clones the repository and installs the `lore`
command as git's credential helper for that instance. Without `/<repo>` it
takes the repository named like the project, or the project's only one. From
then on, `git fetch`, `git pull` and `git push` work as with any other host.

In an existing checkout, `lore code remote --add` adds the repository as a
remote named `lore`.

Members push; Viewers clone and read. Deleting the default branch is refused,
and so is a push to a repository over its size cap. A force-push that rewrites
the default branch's history is refused as well: pull, then push again. Other
branches still take one.

### In CI

Set `LORE_API_KEY` to an API key, and the credential helper answers git with
it. A key narrowed to **Clone and fetch repositories** and **Push to
repositories** is all a pipeline needs.

## Browsing code

**Code** in the sidebar opens the project's repositories: each with its
default branch's last commit and how to clone it. A project with one
repository opens it directly. A repository's page has four tabs.

- **Files**: the default branch's folders and files, each with the last commit
  that touched it, and the folder's `README` rendered under them. Its links
  and images stay in the repository, at the same branch. Pick another branch
  or tag from the menu above the list.
- **A file** shows its lines highlighted and numbered. Click a line number to
  select it, Shift-click another to select a range: the address carries it
  (`#L10-L20`). **Permalink** swaps the branch for the commit it points at, so
  the link keeps showing those lines after the branch moves. **Raw**
  downloads the file. A Markdown file opens rendered, with **Source** beside
  it.
- **Commits**: the branch's history, newest first, or a file's or a folder's
  from its **History** link. A commit's page shows its message, its parents,
  the quests it landed on and its diff against its first parent.
- **Branches**: each branch with how far it is ahead of and behind the default
  branch, a link to compare them, and, for a member who pushes, a delete. The
  default branch is never deleted. **Tags** lists the tags and the commit each
  points at.

**Compare** shows what one branch has since it left another,
`/compare/main...feature`: its commits and their diff.

**Blame**, from a file's page, says which commit each line came from and the
quest behind it, with a link to the blame before that commit. A long history
answers its first lines at once and fills in the rest while the page is open.

A `.git` URL opened in a browser lands on its repository's page.

### Limits

A file over 1 MiB, or a binary one, is named and downloaded rather than shown.
A diff lists at most 1,000 files, 50 a page, and shows a file's changes only up
to 256 KiB or 5,000 lines a side; a lockfile or a minified bundle is folded
until you open it. Blame takes files up to 256 KiB or 5,000 lines, and walks
200 commits back at most: lines older than that say so.

History, the last commits of a folder and blame come from an index Lore keeps
of every pushed commit. A repository pushed before it existed, or a very large
push, is indexed in the background: the pages say **Indexing history…** until
it has caught up.

## A commit names a quest

A pushed commit whose message names a quest, `#Q123`, is recorded on that
quest's commit list, by whoever pushed it. Nothing else is needed: no hook, no
CI step. A commit the quest already lists is not added twice, even when it
was recorded under a shorter sha.

Only commits that reach an existing branch count. Pushing a new branch records
nothing until its commits land on a branch that already existed, and an import
(below) records nothing at all. Every push appears in the project's activity.

## Moving a repository in

`lore code import` pushes a checkout into a new or empty repository: the
default branch first, then the other branches and the tags. It needs no access
to the old host, so it works from any clone.

```bash
git clone https://github.com/acme/api.git
cd api
lore code repo create api
lore code import api
```

On Lore's cloud a large history goes in by several pushes of at most 40,000
new objects each, and the command stops before pushing anything if a file is
over 32 MiB. Run it again after an interruption: it reads what the repository
already holds and carries on. A self-hosted Lore takes everything in one push.

### Keeping a copy of GitHub

A repository whose home stays on GitHub can still have a copy on Lore, so the
`lore` command and Lore itself can read it. Import it once as above, then add
a step to the pipeline that runs after each merge:

```bash
git push https://<instance>/<project>/<repo>.git "$GITHUB_SHA:refs/heads/main"
```

Push the commit as it is, never with `--force`: without it, git itself
refuses a push that would rewrite the copy's history.

## Backups

Every night, Lore writes each repository that saw a push as a git bundle into
its object storage, and keeps the last seven. A bundle is one file `git clone`
reads, so a repository comes back without a running Lore:

```bash
git clone code-backup.bundle restored
cd restored
lore code repo create api
lore code import api
```

A self-hosted Lore with no object storage configured keeps those bundles on
its own volume, next to the repositories. See
[Self-hosting](/lore/docs/start-self-hosting).

## From the command line

| Command                               | What it does                                                    |
| ------------------------------------- | --------------------------------------------------------------- |
| `lore clone <project>[/<repo>] [dir]` | Clone a repository, with the credential helper installed        |
| `lore code repo list`                 | The project's repositories and their clone URLs                 |
| `lore code repo create <name>`        | Create an empty repository                                      |
| `lore code repo delete <name>`        | Delete a repository and everything in it                        |
| `lore code remote`                    | Print a clone URL; `--add` adds it as a remote of this checkout |
| `lore code import [<repo>]`           | Push this checkout into a new or empty repository               |
| `lore code tree [path]`               | A folder at a branch, tag or commit                             |
| `lore code cat <path>`                | A file, numbered, 200 lines at a time                           |
| `lore code log [path]`                | The history, of one file or folder if given                     |
| `lore code show <sha>`                | One commit, its quests and the files it changed                 |
| `lore code diff <from>..<to> [path]`  | The changed files, or one file's diff                           |
| `lore code blame <path>`              | Each line's commit and quest                                    |

In a checkout of a Lore repository, the read commands find the project and the
repository from its `lore` remote, so `lore code blame src/app.ts` needs no
flag. Elsewhere, `--project` and `--repo` name them, and `--ref` picks a
branch, tag or commit.

The full list is in [The lore CLI](/lore/docs/reference-cli#code).

## From an agent

An agent reads code without a checkout: `code_tree`, `code_file`, `code_log`,
`code_commit`, `code_diff` and `code_blame`, the six commands above. A file and
a blame answer 200 lines at a time; a diff answers its files first and one
file's changes when asked. See [MCP tools](/lore/docs/reference-mcp-tools).
