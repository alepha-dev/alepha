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

## Where the Pages Come From

Each package carries its pages in `node_modules/<package>/docs/<slug>.md`, with a front matter giving the slug, title, summary, package and section. The command looks in the project's `node_modules`, then in each parent directory's, and stops at the one holding `alepha`, so a workspace app whose dependencies are hoisted still finds them.

See [Docs for Agents](/docs/guides-docs-for-agents) for why the docs ship in the package, and how to tell an agent about the command.
