# Gen Command

Generate artifacts from your running application: OpenAPI specs and `.env` templates. `gen` boots your server entry (without starting it) and introspects the real app - the output always matches the code.

## openapi

Generate an OpenAPI specification from your `$action` primitives.

```bash
alepha gen openapi                  # print to stdout
alepha gen openapi --output api.json   # write to a file
```

| Flag             | Description      |
| ---------------- | ---------------- |
| `--output`, `-o` | Output file path |

The `$swagger()` primitive is not required. The document is derived from your `$action` definitions, so `gen openapi` works on any app - it registers the swagger module for the duration of the command if you don't mount one. When `$swagger()` _is_ present, its configuration (title, version, `excludeTags`, `rewrite`, …) is what gets emitted.

## env

Extract every environment variable your app declares via `$env` and emit a documented `.env` template:

```bash
alepha gen env                  # print to stdout
alepha gen env --output .env.example
```

Each variable comes with its description, its default value, whether it's required, its allowed values, the other names it is also read from, and a `(public)` mark when it opted out of being a secret:

```bash
# Port the HTTP server listens on
#SERVER_PORT=3000

# Secret used to sign sessions
# (required)
#APP_SECRET=
```

| Flag             | Description                            |
| ---------------- | -------------------------------------- |
| `--output`, `-o` | Output file path (e.g. `.env.example`) |

This is the same `$env` metadata the [infra plugin](/docs/cli-plugins-infra) uses as its secret allowlist - declare variables with `$env` and every tool in the chain knows about them.
