# Bay — PoC

Self-hosted application server for Alepha apps. The full design lives in the
**Bay** folio of the Alepha project in Lore.

This PoC proves the vertical slice: **an `app.zip` goes in, an HTTPS URL comes out.**

> Installing Bay on a real host: **[INSTALL.md](./INSTALL.md)**. The install itself is four steps;
> granting a user the right to deploy over SSH is a fifth, and it is the one that produces every
> confusing first-deploy failure — an empty `bay-control` group, a `bay` missing from the
> non-interactive PATH, and a host binary too old to read the artifact from stdin.

## What's inside

| | |
|---|---|
| Reverse proxy | routing by `Host`, *file-first / fallback app* |
| Static assets | served from **every kept release**, `.br`/`.gz` negotiation, immutable cache on hashed names |
| Deployment | unzip (with zip-slip guard), manifest read, atomic `current` switch |
| Provisioning | SQLite file, stable `APP_SECRET`, `.env` written atomically at `0600` |
| Supervision | start/stop, graceful shutdown (SIGTERM then SIGKILL), process group |
| State | one JSON file, written `temp + rename`, with a `.bak` |
| Control API | HTTP on loopback, bearer token required |
| CLI | thin client of that same API — **one contract** |

| TLS / ACME | CertMagic, testable **without a public domain or root** via Pebble |
| Observability | `bay status`, `bay logs` — nothing is stored |

## Observing an app without storing anything

Two commands, no time series, no job, no table. That is deliberate: a series
database that has to be administered, pruned and backed up to answer two fixed
questions costs more than the answers.

```bash
bay status --json            # up, restarts, traffic, backup freshness
bay logs lore/production --since 15m --grep 'ECONN' --json
```

**`bay logs` emits JSON Lines.** Its primary reader is an agent over SSH, not
an eyeball: `--json`, `--since`, `--grep` (a regular expression). On a real
host the entries come from journald, which brings its own retention; under the
child runner they come from `logs/app.log`, rotated at 32 MiB.

⚠️ `--since` **keeps** lines with no timestamp and says so at the end of the
output. An app writing plain text to stdout produces none, and hiding them
would suppress exactly the `console.log` you just added.

## What backups cover, and what they do not

**The database, and nothing else.**

| | |
|---|---|
| SQLite database | ✅ snapshot through SQLite's own backup API, verified, then compressed |
| `storage/` (uploads) | ❌ **never** — see below |
| `.env` | ❌ **never** — secrets come from the deployment |

Every backup response says what it did not cover, in words. The worst failure of
a backup system is somebody believing it covers more than it does, and that
belief is cheapest to prevent at the moment they run the command.

### Why uploads are not archived

Bay used to tar `storage/` nightly. That looked like protection and was not:

- **nothing could restore it** — `bay restore` puts the database back and says
  `notRestored: ["storage/"]`;
- **nothing pruned it** — retention only ever walked the `db/` prefix, so the
  archives grew in the bucket forever;
- **it was capped by RAM** — the whole tar was held in memory, so it refused
  anything over 1 GiB and an app that grew past that silently had no coverage.

A one-directional, unprunable, memory-bound copy is not a backup. So uploads are
shared by putting them **in a bucket**, or they are not shared at all:

```bash
bay config s3:apps --endpoint URL --bucket NAME   # a SECOND credential, never the backup one
bay storage migrate <name/env>                    # copies what is on disk, keeps the originals
```

An app left on local storage keeps its files in exactly one place, on this
host's disk. `bay backup` says so every time rather than letting silence imply
otherwise.

⚠️ A bucket is durable, not point-in-time: deleting the wrong key deletes it
everywhere. **Enable versioning on the storage bucket.**

## Testing ACME without a domain

Pebble is Let's Encrypt's test ACME server. It runs the real RFC 8555 locally:
account creation, order, challenge, issuance, renewal (ARI included).

```bash
GOBIN=/tmp/baybin go install github.com/letsencrypt/pebble/v2/cmd/pebble@latest
GOBIN=/tmp/baybin go install github.com/letsencrypt/pebble/v2/cmd/pebble-challtestsrv@latest

BAY_PEBBLE_BIN=/tmp/baybin go test ./internal/tlsconf/ -v
```

The test generates its own CA, starts Pebble and challtestsrv, obtains a real
certificate and verifies it resolves via SNI. Without Pebble on the `PATH` it
is **skipped** — `go test ./...` stays green on a bare checkout.

⚠️ Never add Pebble's CA to the system trust store: its private key is public.

For Let's Encrypt, **always staging first** (`--acme-ca https://acme-staging-v02.api.letsencrypt.org/directory`).
Production quotas are shared and burn fast — and if the domain is on
`sslip.io`, the quota is **pooled across all of its users**.

## What is not here, and why

- **systemd** — does not exist on macOS. The PoC supervises child processes;
  the `runner.Runner` interface exists so systemd can slot in behind it
  (cgroups, `MemoryMax`, journald, `Restart=always` become free).
- **Runtime management** — the PoC borrows the `node` on the `PATH`. The real
  Bay ships its own and handles `bay runtime update`.
- Rollback, backups, scale-to-zero: later phases.

### TODO — application metrics (req/s, latency, event loop)

A `bay top` command existed, reading the Prometheus `/metrics` that
`alepha/server/metrics` exposes. **Removed**, for a reason only visible when
running it on a real machine: that module is **opt-in**, and none of the
deployed apps import it. The feature worked on zero apps out of two, and an
example had to be deployed on purpose just to see it function.

Two observations that will decide the retry:

1. **Bay is already in the right place to count.** The proxy sees every request
   with its status code (`proxy.go`, where `lastSeen.touch` is called) and the
   cgroup gives memory, CPU and restarts. Req/s, err/s and *client-observed*
   latency therefore ask nothing of the app — and would work for all of them,
   non-Alepha included.
2. **What only the app can say**: event-loop lag (the best early signal of a
   Node app about to fall over, invisible from outside), the heap / RSS
   distinction, and business metrics.

When this comes back, it will not be by re-parsing Prometheus text: it will be
an `@alepha/telemetry` built on OpenTelemetry.

## Trying it

```bash
go build -o bay ./cmd/bay

# produce the artifact — no manifest to write, `alepha build` derives it
cd ../example-api
yarn alepha build          # emits dist/ + dist/manifest.json
yarn alepha pack -o /tmp   # emits /tmp/example-api-latest.tar.gz
cd -

./bay serve --root /tmp/bay-root --base-domain bay.localhost &
# No token: the control API listens on /tmp/bay-root/control.sock, and
# `bay deploy` finds it on its own. So you must be on the Bay machine, root
# or a member of the `bay-control` group.
./bay deploy /tmp/example-api-latest.tar.gz --name example-api \
  --control-socket /tmp/bay-root/control.sock

curl -H "Host: example-api.bay.localhost" http://127.0.0.1:8080/
```

⚠️ **`--target=bare` (the default), not `cloudflare`.** A workerd bundle is
resolved against Cloudflare's export conditions and has no entry point node can
execute. Bay refuses it at deploy time and names the fix — otherwise the app
deploys, never boots, and the only message is "never became ready".

## The artifact

Bay consumes **the format the framework already produces**, not a format of its
own:

```
example-api-latest.tar.gz
├── dist/
│   ├── manifest.json     ← derived by `alepha build`
│   ├── index.js
│   └── server/
└── migrations/
```

`dist/manifest.json` is the contract between the build and all of its
consumers — `alepha platform up --prebuilt`, Alepha Rocket, and Bay. Declaring
`$repository` is what puts `hasDatabase: true` in it, and that `true` is what
provisions the database **and** grants write access in the sandbox. Nobody
writes the same thing twice, so code ↔ infra drift is impossible by
construction.

A tar unzipped as root earns its guards: absolute paths and `..` refused,
symlinks / hardlinks / devices refused (the classic tar escape is planting a
link to `/etc` then writing "through" it on the next entry), archive mode bits
ignored (a setuid bit in an uploaded tarball would be a privilege-escalation
primitive), and a per-entry size cap (a full disk takes down every app, not
just the one being deployed).

## Measured on this PoC

- `bay` binary: **9.5 MB** (without CertMagic)
- Lore's `app.zip`: **7.79 MB** (zip; 6.34 MB as zstd)
- full deployment, app ready to answer: **0.4 s**
- SSR through the proxy: **43 ms**
- CSS asset: **204 KB** raw → **26 KB** as brotli (−87%)

## What the PoC corrected in the design

1. **The build emits `dist/public/`**, not a `public/` at the archive root.
   Hoisting would mean moving hundreds of files at packaging time for nothing.
2. **Assets are served flat from the web root** (`/entry.DyJ8G-7l.js`), so a
   cache rule keyed on an `/assets/` prefix **never fires**. Detection is done
   on the hashed-name pattern `name.HASH8.ext`.
3. **The build already produces the `.br`/`.gz`** — serving them is nearly free
   and divides the transfer by eight.
4. **ACME challenge ports must be configurable and consistent with what is
   announced to the CA.** Left at defaults, CertMagic serves the challenge on
   80/443 while the CA looks elsewhere, and the failure does not say why
   (`connection refused`). Hence `--acme-http-port` / `--acme-tls-port`.

## Structure

```
cmd/bay/          CLI + server + control API
internal/
  manifest/       manifest.json reading and validation
  state/          JSON state, atomic writes
  deploy/         unzip, provisioning, release switch
  runner/         process lifecycle (systemd behind this interface)
  proxy/          host routing, statics, reverse proxy
```

## Invariants under test

`go test ./...`

- a `runtimeVersion` pinned to an exact version is **refused** — it would
  recreate the problem Bay solves (patching a CVE without redeploying every
  app)
- an app declaring crons is **never** eligible for scale-to-zero
- state survives a restart, is written at `0600`, leaves a `.bak` and no
  temporary files
- the token is generated once and persists
