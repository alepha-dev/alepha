# Bay

Self-hosted application server for Alepha apps. One static Go binary and a data
directory: it is the reverse proxy, the deployer, the supervisor and the
backup schedule for every app on the host.

An artifact goes in over SSH, an HTTPS URL comes out.

```bash
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o bay ./cmd/bay
scp bay root@HOST:/opt/bay/bin/bay
```

**→ [INSTALL.md](./INSTALL.md) is the guide.** Four steps to a running Bay, and
a fifth - granting a human or a CI job the right to deploy - that is the one
people miss and the source of every confusing first-deploy failure.

The full design lives in the **bay** directory of the Alepha project in Lore.

## The shape of it

|                   |                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| **Artifact**      | the `tar.gz` `alepha pack` already produces - no Bay-specific format, no manifest to hand-write |
| **Deployment**    | untar under guard, provision, atomic `current` switch, health-gated rollback watch              |
| **Supervision**   | a systemd unit per instance, each running as its own unix user, in its own sandbox              |
| **Reverse proxy** | routing by `Host`, file-first then app, statics from every kept release with `.br`/`.gz`        |
| **TLS**           | CertMagic + ACME, exercisable end to end without a public domain or root (Pebble)               |
| **Provisioning**  | SQLite file, stable `APP_SECRET`, per-instance `.env` written atomically at `0600`              |
| **Backups**       | scheduled snapshot of the database, verified, compressed, uploaded, pruned                      |
| **Control API**   | HTTP over a **unix socket**, authorized by the file mode. No port, no token                     |
| **CLI**           | every command except `serve` is a thin client of that same API - one contract                   |

`bay` with no arguments prints the full command list, and that usage text is
the reference for flags - this table is the map, not the manual.

## Two things worth knowing before reading the code

**There is no inbound control port and no bearer token.** The control API can
create users, read every app's secrets and delete every backup, so it is
root-equivalent. A loopback port with a shared secret is the wrong shape for
that: any process on the host can reach the port, the secret ends up in a shell
history, and a bind-address typo publishes it. The socket's authorization is
the file mode, enforced by the kernel. Remote access is SSH and nothing else.

**Backups cover the database and nothing else**, and every backup response says
so in words. `storage/` (uploads) and `.env` are never archived - uploads are
shared by putting them in a bucket (`bay config s3:apps`, a _second_ credential
that is never the backup one) or they are not shared at all, and secrets come
from the deploy. The worst failure of a backup system is somebody believing it
covers more than it does.

## Working on Bay

⚠️ **`yarn v` does not run any of this.** It is the JavaScript pipeline; a
green `yarn v` says nothing about the Go. The Go lane is its own command, and
it runs in a Linux container because that is the only place the whole suite
compiles:

```bash
yarn v:go     # gofmt, vet, build, tests, cross-compile - reproduces the CI job
```

`go test ./...` on a Mac is **not** a substitute. Every file under
`internal/runner` that renders or applies a systemd unit is `//go:build linux`,
so a native run skips them silently and reports success. Docker must be
running.

### Testing ACME without a domain

Pebble is Let's Encrypt's test ACME server, running the real RFC 8555 locally:
account, order, challenge, issuance, renewal (ARI included).

```bash
GOBIN=/tmp/baybin go install github.com/letsencrypt/pebble/v2/cmd/pebble@latest
GOBIN=/tmp/baybin go install github.com/letsencrypt/pebble/v2/cmd/pebble-challtestsrv@latest

BAY_PEBBLE_BIN=/tmp/baybin go test ./internal/tlsconf/ -v
```

The test generates its own CA, starts Pebble and challtestsrv, obtains a real
certificate and verifies it resolves over SNI. Without Pebble on the `PATH` the
suite skips it, so a bare checkout stays green.

⚠️ Never add Pebble's CA to the system trust store: its private key is public.

⚠️ **The challenge ports have to be configurable and to agree with what is
announced to the CA.** Left at their defaults, CertMagic serves the challenge on
80/443 while the CA looks elsewhere, and the failure says only `connection
refused`. Hence `--acme-http-port` / `--acme-tls-port`.

For Let's Encrypt, **always staging first**
(`--acme-ca https://acme-staging-v02.api.letsencrypt.org/directory`). Production
quotas are shared and burn fast - and on `sslip.io` the quota is pooled across
every user of the domain.

## Structure

```
cmd/bay/          CLI + server + control API
internal/
  backup/         snapshot, verify, upload, prune
  control/        the unix socket the control API is reached through
  deploy/         untar, provisioning, release switch, rollback
  health/         "is this app serving?", which is not "is a port open?"
  manifest/       manifest.json reading and validation
  proxy/          host routing, statics, reverse proxy
  runner/         instance lifecycle - systemd on Linux, child processes elsewhere
  runtimes/       which interpreter runs an app - Bay ships them, never borrows PATH
  s3/             the S3-compatible client backups and app storage share
  schedule/       when a backup is due, and when one is stale
  state/          one JSON document, atomic writes, kept at 0600
  tlsconf/        CertMagic wiring, ACME, private-CA trust for tests
```

## The artifact

Bay consumes the format the framework already produces:

```
example-api-latest.tar.gz
├── dist/
│   ├── manifest.json     ← derived by `alepha build`
│   ├── index.js
│   └── server/
└── migrations/
```

`dist/manifest.json` is the contract between the build and all of its
consumers - `alepha platform up --prebuilt`, Alepha Rocket, and Bay. Declaring
`$repository` is what puts `hasDatabase: true` in it, and that `true` is what
provisions the database **and** grants write access in the sandbox. Nobody
writes the same fact twice, so code ↔ infra drift is impossible by
construction.

⚠️ **`--target=bare` (the default), not `cloudflare`.** A workerd bundle is
resolved against Cloudflare's export conditions and has no entry point node can
execute. Bay refuses it at deploy time and names the fix - otherwise the app
deploys, never boots, and the only message is "never became ready".

A tar untarred as root earns its guards: absolute paths and `..` refused,
symlinks / hardlinks / devices refused (the classic escape is planting a link
to `/etc` then writing "through" it on the next entry), archive mode bits
ignored (a setuid bit in an uploaded tarball would be a privilege-escalation
primitive), and a per-entry size cap (a full disk takes down every app, not
just the one being deployed).

## Observing an app without storing anything

Two commands. No time series, no job, no table - a series database that has to
be administered, pruned and backed up to answer two fixed questions costs more
than the answers.

```bash
bay status --json            # up, restarts, traffic, backup freshness
bay logs lore/production --since 15m --grep 'ECONN' --json
```

`bay logs`' primary reader is an agent over SSH, not an eyeball, hence `--json`,
`--since` and `--grep` (a regular expression). Entries come from journald on a
real host, and from `logs/app.log` (rotated at 32 MiB) under the child runner.

⚠️ `--since` **keeps** lines with no timestamp and says so at the end of the
output. An app writing plain text to stdout produces none, and hiding them
would suppress exactly the `console.log` you just added.

### The same two answers, on a page

A Bay connected to Lore pushes what `bay status --json` computes, on its
report interval and after every command that changes something, and Lore
renders it at `/bay/:estateId`. `computeStatus` is one function with two
callers for that reason: a second copy of the backup-staleness rule would
drift invisibly, since each copy looks right on its own.

**No time series was added.** The console reads the LATEST frame, stored as
one row per estate and replaced on every push, which is the same "no table to
prune" position as above rather than an exception to it. The CPU and memory
chart is the one series, it is off by default, and what it stores is a mean
that discloses its own sampling.

Nothing here makes the CLI a second-class reader: the host is still fully
operable over SSH with no Lore at all, and `bay logs` still answers on the
machine. What the console adds is the reconciliation, which is the one
question a host cannot answer alone: the machine reports `(app, env)` and
knows nothing about projects, so "an instance Lore expects here that is not
running" only exists where both sides are visible.

### Application metrics are deliberately absent

A `bay top` reading the Prometheus `/metrics` of `alepha/server/metrics` existed
and was removed: that module is opt-in and none of the deployed apps imported
it, so the feature worked on zero apps out of two and an example had to be
deployed on purpose to see it run at all.

Two observations that will decide the retry:

1. **Bay is already in the right place to count.** The proxy sees every request
   with its status code, and the cgroup gives memory, CPU and restarts. Req/s,
   err/s and _client-observed_ latency therefore ask nothing of the app, and
   would work for all of them - non-Alepha included.
2. **What only the app can say**: event-loop lag (the best early signal of a
   Node app about to fall over, and invisible from outside), the heap/RSS
   distinction, and business metrics.

⚠️ **The console does not change either observation, and it is not the retry.**
It renders what the cgroup and the proxy already give - memory, restarts, last
request, backup freshness - which is the first observation acted on, not the
second answered. Event-loop lag is still invisible from outside a process; a
heap figure is still something only the runtime holds; a business metric is
still the app's to define. What moved is the premise the removal rested on:
there is a consumer now, so a number worth computing has somewhere to be
read.

When the rest returns it will not be by re-parsing Prometheus text; it will be
an `@alepha/telemetry` built on OpenTelemetry, and it will report from inside
the app rather than being guessed at from outside it.
