# Run Modes and Commands

Most of the time an Alepha app is a server. Sometimes the same codebase has to
be something else for thirty seconds: apply migrations, seed a database, print a
report, drain a queue. Two primitives cover that without a second entry point
and without a second copy of your wiring.

| Primitive  | Import           | Triggered by            | Good for                             |
| ---------- | ---------------- | ----------------------- | ------------------------------------ |
| `$mode`    | `alepha`         | An environment variable | One-shot tasks in the deployed image |
| `$command` | `alepha/command` | A CLI argument          | Tooling humans invoke by name        |

## `$mode`

`$mode` gates a whole bootstrap on an environment variable. When it matches, the
declaring class becomes `alepha.target` and the dependency graph is **pruned to
that class and its transitive dependencies**. The HTTP server, the job
scheduler, the cron ticker: none of them are constructed, because nothing in the
kept subgraph asks for them.

```typescript check
import { $inject, $mode } from "alepha";
import { DatabaseProvider } from "alepha/orm";

class DbMigrationMode {
  db = $inject(DatabaseProvider);

  mode = $mode({
    env: "MIGRATE",
    ready: async () => {
      await this.db.migrate();
    },
  });
}
```

```bash
MIGRATE=true node app.js
```

`MODE=MIGRATE node app.js` does the same thing. Two spellings because two
callers want different shapes: a Kubernetes init container sets one variable per
job, while a single-variable `MODE` suits a container image that takes one
argument.

That pruning is the point. A migration container that boots the HTTP server has
to bind a port it will never serve, and a seed job that starts the cron ticker
fires whatever was due. Running the task inside the real container, with the
real DI graph and the real configuration, and _nothing else_, is what makes this
different from a script that imports your services.

After `ready` resolves or throws, `alepha.stop()` runs, so connections close and
the process exits. Omit `ready` and the mode still prunes the graph but the
process stays alive, which is what a queue worker or a cron-only deployment
wants.

`$mode` returns a boolean, so a class can branch on whether it is the active
mode.

### `MIGRATE=false` does not activate it

The check is `isEnvEnabled`, not truthiness. `MIGRATE=false`, `MIGRATE=0` and
`MIGRATE=` all leave the mode off. This is worth stating because the naive
version of this check treats every non-empty string as true, and `MIGRATE=false`
then runs your migrations.

## `$command`

`$command` declares a CLI command: its name, its flags, its arguments, the
environment it requires, and its handler.

```typescript check
import { z } from "alepha";
import { $command } from "alepha/command";

class ReportCommands {
  report = $command({
    name: "report",
    description: "Render a usage report",
    args: z.text(),
    flags: z.object({
      format: z.enum(["json", "csv"]).default("json"),
      verbose: z.boolean().default(false),
    }),
    env: z.object({
      REPORT_TOKEN: z.text({ description: "API token for the report service" }),
    }),
    handler: async ({ args, flags, env, print }) => {
      print(`${args} as ${flags.format} with ${env.REPORT_TOKEN.length} chars`);
    },
  });
}
```

Register the class in your `alepha.config.ts` and it is reachable through the
`alepha` CLI:

```typescript
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  services: [ReportCommands],
});
```

```bash
alepha report monthly --format=csv --verbose
```

Everything on the declaration does double duty. `flags` and `args` are parsed
_and_ validated _and_ printed in `--help`. `env` is validated before the handler
runs, so a missing token is a clear failure at second zero rather than a
`undefined` three API calls in.

### Flag syntax

`--name value` and `--name=value` are equivalent. A boolean flag needs no value:
`--compile` turns it on, and `--no-compile` or `--compile=false` turns it off. A
bare `--` ends flag parsing, so everything after it is an argument even when it
starts with a dash.

### What the handler gets

| Field   | Is                                                                |
| ------- | ----------------------------------------------------------------- |
| `flags` | Parsed and validated against `flags`                              |
| `args`  | Parsed and validated against `args`                               |
| `env`   | Validated against `env`, guaranteed present                       |
| `run`   | Runs a labelled step, or a shell command, with progress reporting |
| `ask`   | Interactive prompts                                               |
| `print` | Writes a line to stdout                                           |
| `fs`    | `node:fs/promises`                                                |
| `glob`  | `node:fs/promises`' `glob`                                        |
| `root`  | The directory the command is running in                           |
| `help`  | Prints this command's help                                        |

**`print` is not the logger, and the distinction matters.** Output is what a
command _produces_; the logger is what it _reports_. Anything a caller might
pipe, parse or redirect goes through `print`. Sending it to the logger instead
is how `alepha --version` once answered `18:21:36 I Alepha v0.24.0`, in colour,
in a shape that changed with `LOG_FORMAT`: an environment variable the calling
script does not control. `print` strips colour when stdout is not a TTY, so a
coloured string is still safe to pipe.

### Subcommands

`children` turns a command into a parent:

```typescript check
import { $command } from "alepha/command";

class PublishCommands {
  vercel = $command({
    description: "Deploy to Vercel",
    handler: async ({ print }) => print("vercel"),
  });

  cloudflare = $command({
    description: "Deploy to Cloudflare",
    handler: async ({ print }) => print("cloudflare"),
  });

  publish = $command({
    description: "Publish the application",
    children: [this.vercel, this.cloudflare],
    handler: async ({ help }) => help(),
  });
}
```

`alepha publish vercel` runs the child; `alepha publish` runs the parent
handler, which here prints the help rather than guessing.

### Hooks

`pre` and `post` attach a command to another one by name. They are hidden from
help, cannot be invoked directly, and receive the same parsed flags and
arguments as their target.

```typescript check
import { $command } from "alepha/command";

class BuildCommands {
  build = $command({
    name: "build",
    handler: async ({ print }) => print("building"),
  });

  prebuild = $command({
    pre: "build",
    handler: async ({ run }) => {
      await run("cleaning dist", async () => {});
    },
  });
}
```

### `mode`

`mode: true` adds a `--mode, -m` flag that loads environment files the way Vite
does: `.env` and `.env.local` always, plus `.env.<mode>` and `.env.<mode>.local`
when a mode is given. Pass a string instead of `true` to set a default, so a
publish command can load production files without anyone typing
`--mode production`.

## See also

- [Migrations](/docs/guides-persistence-migrations) for the migration commands
  that ship with the CLI
- [The Alepha Instance](/docs/guides-core-alepha-instance) for the lifecycle
  `$mode` is pruning
