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

Commits are grouped by conventional-commit type (`feat`, `fix`, ...), ready to paste into release notes.
