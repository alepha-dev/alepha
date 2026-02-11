# Configuration Architecture

Alepha has three configuration primitives. Each serves a distinct purpose with clear boundaries.

## Overview

| Primitive | Source | Mutability | Purpose |
|-----------|--------|------------|---------|
| `$env` | `process.env` | Static, boot-time | Secrets & deployment identity |
| `$atom` | Defaults + `config.json` | Dev-mutable via devtools | App behavior & framework knobs |
| `$parameter` | Database | Prod-mutable, instant propagation | Operational toggles & feature flags |

## `$env` — Secrets & universal ops conventions

`$env` is for values that **must differ between deployments** and that **any DevOps person would recognize without reading Alepha docs**.

The test: _"Would a DevOps person know what this does without reading Alepha docs?"_ If yes, it belongs in `$env`.

**Allowed in `$env`:**

- `SERVER_PORT`, `SERVER_HOST` — every server framework has these
- `LOG_LEVEL`, `LOG_FORMAT` — standard logging config
- `NODE_ENV`, `ALEPHA_ENV` — deployment identity
- `DATABASE_URL`, `REDIS_URL` — connection strings
- Secrets, API keys, tokens

**Not allowed in `$env`:**

- Framework-specific behavior (retry counts, cache TTLs, rate limits, CORS config, etc.)
- Anything that requires reading Alepha docs to understand

This keeps `.env` files small (~10-15 vars) and immediately understandable.

## `$atom` — App behavior & framework knobs

`$atom` is for **all application and framework configuration** that isn't a secret or a universal ops convention.

Atoms are:

- **Typed & validated** at boot via their schema
- **Discoverable** — devtools lists every atom with its current value
- **Overridable** via `config.json` in the project root
- **Tweakable** in development via `/__devtools/`

The framework itself uses `$atom` for its own knobs. Users never need to hunt for undocumented env vars — every configurable behavior is visible in devtools.

**Bridging `$env` to `$atom`:**

Many atoms derive their default value from `$env` behind the scenes (e.g., `LOG_LEVEL` env → `logLevel` atom). This is the standard pattern: `$env` feeds the initial value, `$atom` owns the runtime config.

If a user wants to control a framework atom via env in Docker/K8s, they wire it themselves through `config.json` or in their application code. The framework does not impose env vars for every knob.

## `$parameter` — Runtime operational config

`$parameter` is a persistent `$atom` backed by the database. Use it for values that **must be changeable in production without redeployment**.

- Feature flags
- Business rules (rate limits, thresholds)
- Operational toggles

Updates to parameters propagate instantly to all running services.

## Decision guide

When adding a new configuration value, ask these questions in order:

1. **Is it a secret, connection string, or universally recognized server config?** → `$env`
2. **Does it need to change in production without redeployment?** → `$parameter`
3. **Everything else** → `$atom`

When in doubt, use `$atom`. It's the safest default — typed, validated, discoverable, and easily promoted to `$parameter` later if runtime mutability is needed.
