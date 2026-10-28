# Docs Command

Print the Alepha documentation of the version this project installed, from `node_modules`, word for word. Written for agents: plain markdown on stdout, no colour, no network.

## Quick Start

```bash
alepha docs                 # the index: one line per installed page
alepha docs '$entity'       # one page, by slug or by name
alepha docs --grep paginate # every line containing "paginate"
```

## Arguments and Flags

| Form            | Prints                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| (none)          | The index of every installed `alepha` and `@alepha/*` page, grouped by package and section                                |
| `<page>`        | One page without its front matter. A slug, a title (`$entity`, `useForm`, `action`), or the end of a slug (`server-cors`) |
| `--grep <text>` | Every matching line as `<slug>:<line>: <text>`, case insensitive, at most 200 lines                                       |

An unknown page prints the closest matches and exits with code 1; a name matching several pages lists them and exits with code 1 too.

## Your Own App: `--app`

`alepha docs --app` describes the project's app instead of the framework. It loads the app into a container without starting it, as `alepha gen openapi` does, and prints what it registers, read from the inspector's metadata:

```bash
alepha docs --app                        # overview: every section, one line per item
alepha docs --app actions                # one section in full, schemas included
alepha docs --app actions --grep quest   # only the items mentioning "quest"
```

The sections are `actions`, `entities`, `pages`, `routes`, `jobs`, `topics` and `env`. Schemas print as TypeScript-like types (`{ id: string (uuid); name?: string }`). The `env` section lists variable names, types, defaults and the service declaring them, **never their values**.

The overview stays small enough for a prompt and a full section may not: measured on the shop example, the overview is 26 KB and `--app actions` 68 KB; on Lore, 75 KB and 257 KB. Narrow a large section with `--grep`.

## Where the Pages Come From

Each package carries its pages in `node_modules/<package>/docs/<slug>.md`, with a front matter giving the slug, title, summary, package and section. The command looks in the project's `node_modules`, then in each parent directory's, and stops at the one holding `alepha`, so a workspace app whose dependencies are hoisted still finds them.

See [Docs for Agents](/docs/guides-docs-for-agents) for why the docs ship in the package, and how to tell an agent about the command.
