# Gen Command

Generate artifacts from your running application: OpenAPI specs, `.env` templates, and changelogs. `gen` boots your server entry (without starting it) and introspects the real app — the output always matches the code.

## openapi

Generate an OpenAPI specification from your `$action` primitives.

```bash
alepha gen openapi                  # print to stdout
alepha gen openapi --out api.json   # write to a file
```

| Flag | Description |
|------|-------------|
| `--out`, `-o` | Output file path |

Requires the `$swagger()` primitive in your server configuration — the command fails with a clear message if it's missing.

## env

Extract every environment variable your app declares via `$env` and emit a documented `.env` template:

```bash
alepha gen env                  # print to stdout
alepha gen env --out .env.example
```

Each variable comes with its description, its default value, whether it's required, and its allowed values:

```bash
# Port the HTTP server listens on
#SERVER_PORT=3000

# Secret used to sign sessions
# (required)
#APP_SECRET=
```

| Flag | Description |
|------|-------------|
| `--out`, `-o` | Output file path (e.g. `.env.example`) |

This is the same `$env` metadata the [platform plugin](/docs/cli-plugins-platform) uses as its secret allowlist — declare variables with `$env` and every tool in the chain knows about them.

## changelog

Generate a changelog from conventional commits, printed to stdout.

```bash
alepha gen changelog                       # latest tag → HEAD
alepha gen changelog --from=1.0.0          # specific range
alepha gen changelog --from=1.0.0 --to=main
```

| Flag | Description |
|------|-------------|
| `--from`, `-f` | Starting ref — tag, commit, or branch (default: latest version tag) |
| `--to`, `-t` | Ending ref (default: `HEAD`) |

Only commits with a **type and a scope** are read — `feat(orm): …`, `fix(server): …`. Anything else is skipped, so work in progress can be committed without landing in release notes.

### What gets published

By default: `feat` and `fix`, in that order, every scope. Both halves are configurable in `alepha.config.ts`:

```ts
import { changelogOptions } from "alepha/cli";

alepha.set(changelogOptions, {
  // Sections appear in this order. Listing a type is the only way it is
  // published — add "perf" and a Performance section appears.
  types: ["feat", "fix"],

  // An allowlist. Unset publishes every scope.
  scopes: ["core", "orm", "server", "api"],
});
```

**Prefer `scopes` over `ignore` once a repository has more than one thing in it.** A denylist has to be edited every time a new app or package appears, and the edit nobody remembers is the one that leaks internal work into a public note. An allowlist fails the other way — a missing entry gets reported by whoever expected it; a leaked one does not.

Scopes match on the segment before the first `/`, so `api` covers `api/users`. A commit with several scopes is published when any one of them is allowed, and lists only those — `fix(orm,internal)` prints as **orm**.

| Option | Default | Meaning |
|--------|---------|---------|
| `types` | `["feat", "fix"]` | Types to publish, in section order |
| `scopes` | *unset* | Scopes to publish; unset means all |
| `ignore` | see `DEFAULT_IGNORE` | Scopes to exclude — applied only when `scopes` is unset |
