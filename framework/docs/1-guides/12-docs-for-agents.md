# Docs for Agents

Every Alepha package ships its own documentation, as plain markdown, inside its npm package.
`npx alepha docs` prints it. An agent that reads it learns the framework at the version the
project installed, word for word, with no network.

```bash
npx alepha docs                 # the index: one line per installed page
npx alepha docs guides-server-building-an-api   # one page, by slug
npx alepha docs '$entity'       # a primitive, hook or provider, by name
npx alepha docs --grep paginate # every line of every page containing "paginate"
```

The flags and lookup rules are in the [Docs Command](/docs/cli-commands-docs) reference.

## Why the docs ship in the package

alepha.dev documents the latest release, and `alepha.dev/llms.txt` is where an agent used to
start. That has three problems, and the package copy has none of them:

- **The version.** A project on an older release reads about APIs it does not have, or misses
  the ones it does. The pages in `node_modules/alepha/docs/` are the pages of the installed
  version, so they can never disagree with the code next to them.
- **The summary.** A web fetch tool usually condenses a page before the model sees it, and a
  rule like "never call `Date.now()`" is exactly what a summary drops. `alepha docs` prints the
  page as written.
- **The network.** Sandboxes, CI runners and offline sessions cannot reach the site. The
  package is already on disk.

## The four forms, for the framework

**The index.** `npx alepha docs` with no argument lists every page of every installed Alepha
package, grouped by package and section, one line each: slug, title, one-sentence summary.
It never prints the pages themselves: the whole corpus is about 2 MB, more than an agent
should read to answer one question. Only installed packages appear, so a project without
`@alepha/ui` sees none of its pages.

**One page.** `npx alepha docs <slug>` prints the page, exactly as written. The slug is the
one in the index, and the same as the site's URL (`alepha.dev/docs/<slug>`). A name works too:
`npx alepha docs '$entity'`, `npx alepha docs useForm`, `npx alepha docs action` (the `$` is
optional), or the end of a slug, `npx alepha docs server-cors`. Quote a name that starts with
`$`, or the shell expands it.

**A search.** `npx alepha docs --grep <text>` prints every line containing the text, case
insensitive, as `<slug>:<line>: <text>`. Past 200 lines it stops and says how many more there
were.

**A miss.** An unknown name prints the closest pages and exits with code 1:

```text
No page matches "entty". Closest:

- reference-primitives-$entity ($entity): Creates a database entity primitive ...

Print one with `npx alepha docs <slug>`.
```

The output is plain markdown with no colour and no spinner, whether or not stdout is a
terminal: the reader is usually an agent piping it.

## Your own app

The framework's manual is half of what an agent needs; the other half is a map of the app it
is editing. `npx alepha docs --app` prints it, read from the app's container rather than guessed
from its source tree: every `$action` with its path, method and schemas, every `$entity` with
its columns, the `$page`s, `$route`s, `$job`s and `$topic`s, and the environment variables
(names, types and defaults, never values).

```bash
npx alepha docs --app                        # the overview, one line per item
npx alepha docs --app entities               # one section in full
npx alepha docs --app actions --grep invoice # only what mentions "invoice"
```

The app is loaded but not started, so no server binds and no job runs. The
[Docs Command](/docs/cli-commands-docs) page has the sections and their sizes on a real app.

## The files

The command reads files, and an agent that greps can read them without it:

```text
node_modules/alepha/docs/<slug>.md
node_modules/@alepha/ui/docs/<slug>.md
node_modules/@alepha/<package>/docs/<slug>.md
```

`alepha` carries the guides, the reference, the CLI pages and its own package pages; each
`@alepha/*` package carries its own. Each page starts with a front matter:

```yaml
---
slug: "reference-primitives-$entity"
title: "$entity"
summary: "Creates a database entity primitive that defines table structure using Zod schemas."
package: "alepha"
section: "reference"
---
```

Links between pages are relative paths to the other files (`./guides-persistence-repository.md`,
`../../../alepha/docs/reference-react-hooks-useform.md`), never URLs on alepha.dev, so following
one stays on the installed version.

## Telling an agent about it

A project created by `alepha init` already does: its `AGENTS.md` (which `CLAUDE.md` imports)
tells the agent to run `npx alepha docs` before writing Alepha code.

A project created before that line existed can add it by hand, near the top of `AGENTS.md`,
`CLAUDE.md`, or whatever file its agent reads:

```markdown
**Before writing Alepha code, run `npx alepha docs`.** It prints the index of the Alepha docs
for the version this project installed; `npx alepha docs <slug>` prints a page, and
`npx alepha docs --grep <text>` searches them. The pages are also plain markdown in
`node_modules/alepha/docs/` and `node_modules/@alepha/*/docs/`.
```

Each package's `package.json` also names the local docs in an `llmsLocal` field (`"./docs"`),
beside the `llms` field that points at the site.
