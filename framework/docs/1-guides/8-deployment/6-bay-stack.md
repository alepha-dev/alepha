# Postgres and Redis on a Bay Stack

A [Bay](/docs/guides-deployment-bay) deploys an app on its own with SQLite in the instance's
directory. Once the app outgrows that, or needs Redis for sessions, locks and caches shared across
restarts, it moves into a **stack**: a `compose.yml` applied on the same VPS, where Postgres and
Redis run from their official images and the app runs beside them. Bay still runs the app itself,
blue/green, from the same `.tar.zst` artifact, and still does the proxy, TLS and backups.

This guide takes an app from SQLite to a stack named `mcs`, with a production and a staging
environment on one machine.

## The compose file

Put it at the root of the app's repository:

```yaml
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: app
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U app -d app"]
      interval: 2s
      retries: 30
    x-lore:
      backup:
        postgres: { user: app, db: app }
  redis:
    image: redis:7-alpine
    volumes: [redisdata:/data]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 2s
      retries: 30
  web:
    depends_on: [db, redis]
    x-lore:
      app: myapp
      routes: ["@"]
volumes:
  pgdata:
  redisdata:
```

- **`web` is the app.** `x-lore: { app: myapp }` marks it as a service Bay runs from an artifact,
  and names the app deployed into it: the `name` of `infra()` (or the `package.json` name). It has
  no `image`, and Compose never starts it.
- **`db` and `redis` are plain Compose services.** They reach each other and the app by service name
  on the stack's own network (`db:5432`, `redis:6379`). Bay publishes nothing to the internet but
  the routes.
- **`routes: ["@"]`** serves the app on the environment's base domain. Labels are relative (`@`,
  `api`, `auth`), never full domains, so one file serves production and staging.
- **The healthcheck asks over TCP, `-h 127.0.0.1`.** Bay starts the app once every service it
  depends on is healthy. On its first boot the Postgres image runs a temporary server on the unix
  socket only, before it creates `POSTGRES_DB`, so a socket check (`pg_isready` without `-h`)
  reports healthy while the database does not exist yet. The temporary server never listens on
  TCP.
- **`x-lore.backup`** tells Bay how to dump Postgres, under the same schedule as an app's SQLite
  database. See [what backups cover](#what-backups-cover).
- **`${POSTGRES_PASSWORD}`** comes from the stack environment's variables, below. A variable the
  file uses and the environment lacks is refused at deploy rather than left empty.

This exact file is applied on a real Docker daemon in Bay's own test suite, with an app reaching
Postgres and Redis through it.

## Migrations for Postgres

The app's migrations live in `migrations/<provider>/`, and a SQLite app only has
`migrations/sqlite/`. Generate the Postgres ones once against a local Postgres, then commit them:

```bash
DATABASE_URL=postgres://app:app@localhost:5432/app alepha db migrations create --name=initial_schema
```

The app applies them itself at boot, as it does on SQLite. See [Migrations](/docs/guides-persistence-migrations).

## Variables

Each stack environment has its own variables. `DATABASE_URL` and `REDIS_URL` are what Alepha reads,
pointing at the services by name; `POSTGRES_PASSWORD` fills the compose file:

```bash
ssh deploy@bay.example.com 'bay stack env set mcs/production -' <<'EOF'
POSTGRES_PASSWORD=a-long-random-password
DATABASE_URL=postgres://app:a-long-random-password@db:5432/app
REDIS_URL=redis://redis:6379
EOF
```

Then the same for `mcs/staging`, with its own password. `bay stack env list mcs/production` shows
the names, never the values.

The app sees Bay's own keys first (`APP_SECRET`, `SERVER_PORT`, ...), then its own secrets (from
`.env.production`, sent by `alepha deploy`), then the stack's variables. `DATABASE_URL` is the one
exception: Bay gives an app that declares a database a SQLite file only when nobody supplied a
database, and a stack's `DATABASE_URL` counts, so the app gets Postgres.

## Deploy the stack, then the app

The stack goes first: it creates the network, the volumes, Postgres and Redis, and records `web` as
waiting for its first artifact.

```bash
scp compose.yml deploy@bay.example.com:
ssh deploy@bay.example.com 'bay stack deploy mcs/production compose.yml'
ssh deploy@bay.example.com 'bay stack deploy mcs/staging compose.yml'
```

Then the app. Point `bay()` at the stack:

```typescript check filename=alepha.config.ts
import { defineConfig } from "alepha/cli/config";
import { bay, infra } from "alepha/cli/infra";

export default defineConfig({
  plugins: [
    infra({
      name: "myapp",
      environments: {
        production: bay({ host: "deploy@bay.example.com", stack: "mcs" }),
        staging: bay({ host: "deploy@bay.example.com", stack: "mcs" }),
      },
    }),
  ],
});
```

```bash
alepha deploy --env staging
```

`alepha deploy` builds and packs as usual, asks the Bay which service of `mcs/staging` runs
`myapp`, and redeploys that one service, blue/green: the new release starts beside the old one and
takes the traffic once healthy. Postgres and Redis keep running. `alepha infra status --env staging`
reports the service and the secrets set on it.

A later change to `compose.yml` (a new service, a new Postgres tag) is a `bay stack deploy` again.
It recreates only the services whose definition changed, and restarts the app service with the new
network and variables. `bay stack rollback mcs/production --to 1` reapplies an earlier revision with
the image digests it ran.

### From Lore

On a Bay enrolled in [Lore](https://lore.alepha.dev) as an estate, the same steps run from the
`lore` CLI, with nothing to copy over ssh:

```bash
lore stack create --file compose.yml --estate vps-ovh
lore stack secrets set --file .env.stack.production --env production
lore stack deploy --env production
```

`.env.stack.production` holds the three variables above, and stays out of git. The app is then
deployed with `alepha deploy` as above, or from Lore with `lore deploy`.

## Production and staging on one VPS

Each environment is its own Compose project (`mcs-production`, `mcs-staging`): its own network,
volumes, variables and containers. Staging cannot reach production's Postgres, and destroying
staging leaves production untouched.

Each gets a base domain, `mcs.<bay's domain>` for production and `mcs-staging.<bay's domain>` for
staging, which `@` resolves against. Serve a real domain from a service with a route:

```bash
ssh deploy@bay.example.com 'bay stack route mcs/production web myapp.com'
```

The `domain` option of `bay()` is not used in a stack: routes belong to the stack, so they survive
every app deploy.

## What backups cover

- **Postgres** is dumped with `pg_dump` inside its container, on Bay's backup schedule, because the
  file declares `x-lore.backup`. `bay backup list mcs/production db` lists the dumps and
  `bay backup restore mcs/production db <backup>` restores one, on the host.
- **Redis** is not backed up: it holds caches, sessions and locks that the app rebuilds. Declare a
  `x-lore.backup` command for it if yours holds anything else.
- **Uploads** go where they go on a lone app: Bay's bucket when one is configured, else the
  instance's `storage/` directory, backed up as before.

`bay stack volumes mcs/production` lists every volume with the hook that covers it, and names the
ones nothing covers rather than staying silent about them.

## Taking it down

`alepha infra down` refuses for an app in a stack: removing one service would leave the compose
file naming a service Bay no longer runs. Remove the service from `compose.yml` and deploy the
stack, or take the whole environment down on the host:

```bash
ssh deploy@bay.example.com 'bay stack destroy mcs/staging'
```

A plain destroy keeps the volumes, the variables and the registry credentials. Deleting the data is
a separate, confirmed step, `--purge`, on the host.
