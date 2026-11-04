# Bay

Self-hosted application server for Alepha apps. One static Go binary and a data
directory: it is the reverse proxy, the deployer, the supervisor and the
backup schedule for every app on the host.

An artifact goes in over SSH, an HTTPS URL comes out.

```bash
curl -sSL https://alepha.dev/bay/install.sh | sudo sh
```

The installer sets up Docker when it is missing (Bay runs every app in a
container, epic E103 in the Lore project Alepha), then fetches the newest
[release](https://github.com/alepha-dev/alepha/releases) for the host's
architecture and verifies its checksum. `bay doctor` checks a host. Or build it
yourself:

```bash
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o bay ./cmd/bay
scp bay root@HOST:/opt/bay/bin/bay
```

**→ [INSTALL.md](./INSTALL.md) is the guide.** Four steps to a running Bay, and
a fifth - granting a human or a CI job the right to deploy - that is the one
people miss and the source of every confusing first-deploy failure.

The design notes live in the Lore project **Alepha** (`lore.alepha.dev/alepha`), area `bay` and the `alepha-bay` directory. Before 2026-10-27 they were in a project of their own, Bay, whose post-split numbers folio F1427 maps.

## The shape of it

|                    |                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| **Artifact**       | the `tar.zst` `alepha pack` already produces - no Bay-specific format, no manifest to hand-write |
| **Deployment**     | untar under guard, provision, atomic `current` switch, health-gated rollback watch               |
| **Supervision**    | a Docker container per instance: the archive runs in the runtime image its manifest names        |
| **Reverse proxy**  | routing by `Host`, file-first then app, statics from every kept release with `.br`/`.gz`         |
| **Static headers** | the release's `public/_headers` applied to every file served from disk, Cloudflare's way         |
| **TLS**            | CertMagic + ACME, exercisable end to end without a public domain or root (Pebble)                |
| **Provisioning**   | SQLite file, stable `APP_SECRET`, per-instance `.env` written atomically at `0600`               |
| **Backups**        | scheduled snapshot of every SQLite file in `data/`, verified, compressed, uploaded, pruned       |
| **Control API**    | HTTP over a **unix socket**, authorized by the file mode. No port, no token                      |
| **CLI**            | apart from `serve` and a few host-side commands, a thin client of that same API - one contract   |

`bay` with no arguments prints the full command list, and that usage text is
the reference for flags - this table is the map, not the manual.

An archive app's container is hardened by default: read-only root, a 64 MB
`/tmp`, no capabilities, its own uid, 512 MiB and 256 processes/threads, and no
host path but its own `data/`, `scratch/` and `storage/`. An app that drives a
browser needs more, and an operator grants exactly that per instance:
`bay runtimes set <name/env> <image>` (an image with the browser in it),
`bay harden <name/env> --memory 1g`, `bay harden <name/env> --pids 1024`, and
`bay harden <name/env> --mount /tmp/.X11-unix` (a host path at the same path
inside, read-only unless `:rw`; never Bay's root or socket, `/etc`, `/run`,
`/home`, `/var/spool`, the container engine, another app's directory, or a
folder Bay already mounts). `bay status` lists each one.

## Two things worth knowing before reading the code

**There is no inbound control port and no bearer token.** The control API
deploys code, and a stack it deploys runs containers with the devices and
capabilities they ask for, so it is root-equivalent. A loopback port with a
shared secret is the wrong shape for that: any process on the host can reach the
port, the secret ends up in a shell history, and a bind-address typo publishes
it. The socket's authorization is the file mode, enforced by the kernel. Remote
access is SSH and nothing else.
The Docker socket Bay drives is root-equivalent for the same reason, and gets
the same treatment: reached as root, over a unix socket only (a `tcp://`
`DOCKER_HOST` is refused), never exposed.

**Backups cover the databases and nothing else**, and every backup response says
so in words. `storage/` (uploads) and `.env` are never archived - uploads are
shared by putting them in a bucket (`bay config s3:apps`, a _second_ credential
that is never the backup one) or they are not shared at all, and secrets come
from the deploy. The worst failure of a backup system is somebody believing it
covers more than it does.

**A backup never sits in memory.** The snapshot is compressed file to file and
streamed to the bucket (in one PUT up to 16 MiB, as a multipart upload in
16 MiB parts beyond (a failed part is retried, a failed upload aborted so no
invisible parts stay billed), then checked with HEAD: it counts only when the
bucket reports the size that was sent. A restore streams back through gunzip
into a file, and a download cut short is an error, never a smaller database.
The size of a database is bounded by the disk, not by Bay's RAM.

**Every SQLite file in `data/` is backed up, together.** Bay finds them by
their header, whatever they are called (an empty `.db`, `.sqlite` or
`.sqlite3` counts too); `-wal`/`-shm`/`-journal`, the copies a restore sets
aside, hidden files and folders (a browser profile's or `HOME`'s own SQLite
stores live there) and symbolic links are left out, each named in the
manifest's `skipped`. Each file is snapshotted with `VACUUM INTO` and integrity-checked in the app's own
runtime, then uploaded as one bundle:

```
apps/<name>-<env>/db/<stamp>/files/<path>.gz
apps/<name>-<env>/db/<stamp>/manifest.json   # uploaded last
```

The manifest is what makes a bundle exist. It records the release, what
triggered the backup, and per file its sizes, sha256, integrity, page counts,
journal mode, the row counts of its 50 biggest tables and its migration
journals (`migrations_<schema>`, `__drizzle_migrations`). A bundle without one
is a backup that died halfway: never listed, never restored, removed by
retention once older than every backup kept. One file failing fails the whole
bundle. A restore checks every file against its sha256 and SQLite before the
app is stopped, then installs them all or none - a failure puts back the
files already replaced. Backups taken before bundles (`<stamp>.sqlite.gz`,
`app.db` only) stay listed and restorable.

`bay restore <name/env>` restores the newest backup; `--key` names one (a key
or a stamp), `--at "2026-10-30 14:00"` takes the newest at or before that time
(read in the policy's timezone, or `--tz`; a date alone is its first moment).
A key must belong to the instance being restored, unless `--from <name/env>`
says to read another instance's backups - staging data into production, say;
only the operator can, through the control socket. `--dry-run` downloads and
verifies the backup and says which databases it would replace, create or leave
alone, without stopping the app. A real restore first backs up the data it is
about to replace, tagged `pre-restore` (kept like any tagged backup), so a
restore of the wrong point can be undone from the bucket; if that backup
fails the restore goes on, and the replaced files are still kept on disk as
`<file>.before-restore-*`.

`bay backup verify <name/env>` is the restore test: it downloads a backup (the
newest, or `--key`/`--at`), checks each file's sha256, opens it with SQLite
and compares its table count with the manifest, without touching the app.
`--all` tests every app and exits non-zero if one fails. The policy's
`verify.every` (7 days by default, `off` to disable, 1h to 90d) runs it on its
own, one app per scheduler tick; a failure is retried after 6h. The last
result shows in the app's state (`lastVerifyAt`, `lastVerifyError`).

A deploy that creates the database restores the latest backup first. When it
cannot find out whether there is one (no bucket configured yet, bucket
unreachable, download or install failed) the app still starts, on an empty
database, and the instance is marked **restore pending**: its new data keeps
being backed up, but pruning is paused while a backup older than that empty
start exists, so `keep N` never deletes the real data on its own. It shows as
a problem in `bay status` and the inventory until `bay restore <name/env>`
brings the data back or `bay restore <name/env> --dismiss` keeps the new
database.

**Each app has a backup policy**, resolved from four layers, lowest first:
built-in (`serve --backup-interval`, keep 14) < global (`bay config backup`)
< app (`bay deploy --backup-policy`, replaced by every deploy) < operator
(`bay backup config <name/env>`, kept across deploys). A layer sets only what
it names; the rest comes from below. The app's retention may keep more than
the global one, never less: a deploy cannot delete the history the operator
asked for.

```json
{
  "enabled": true,
  "schedule": {
    "at": ["03:00", "15:00"],
    "timezone": "Europe/Paris",
    "jitter": "10m"
  },
  "window": "01:00-06:00",
  "minGap": "1h",
  "onDeploy": true,
  "retention": {
    "keep": 7,
    "daily": 14,
    "weekly": 8,
    "monthly": 12,
    "maxAge": "400d"
  },
  "verify": { "every": "7d" }
}
```

The schedule is one shape: `every` (an interval), `at` (times of day) or
`cron` (five fields), read in `timezone` (UTC by default) and spread by up to
`jitter` (capped at half the shortest gap). A layer that names a shape
replaces the whole shape below it; timezone and jitter are inherited field by
field. `window` keeps scheduled starts inside a time range (`any` lifts one
set below), and `minGap` skips a slot that comes too soon after the last
backup, whatever took it. A failed scheduled backup is retried after 1m, 5m,
then every 15m until one succeeds.

Retention keeps the newest `keep` backups, plus the newest backup of each of
the last N hours, days, weeks (ISO), months and years that have one, counted
in the schedule's timezone; `maxAge` then drops anything older. The newest
backup is always kept, and if it is under half the size of the largest of the
last 30 days, the newest backup of normal size is kept too, so an emptied
database never pushes the real data out. `onDeploy` takes a backup tagged
`pre-deploy` before each deploy of an instance that already has data; those
are kept apart (`keepPreDeploy`, 5 by default), and a failure is logged and
reported without blocking the deploy. `bay backup <name/env> --tag before-v2`
takes a tagged backup that neither the rules nor `maxAge` ever delete
(`keepTagged`, on by default). `prune: "lifecycle"`
(operator or global only) leaves deletion to the bucket's own expiry rules.
`bay backups <name/env> --plan` shows what each rule keeps and what the next
prune would delete, and why.

A field this Bay does not enforce is refused rather than stored, so a policy
never reads as doing more than it does. The app layer is untrusted input: it
is checked before the upload is staged (every 5m to 31d, keep 1 to 365 per rule) and a bad one
refuses the deploy. From an Alepha project, the app layer is the environment's
`backup` option in `alepha.config.ts` (`bay({ host, backup: { … } })`), which
`alepha deploy` sends as `--backup-policy`; leaving it out sends nothing, so
the next deploy drops the earlier declaration. `--backup-interval 0` turns scheduling off by default, and
any layer can turn it back on for one app; `enabled: false` stops the schedule
only: `bay backup` still works, and the app is not reported stale.
`bay status` and the inventory show the effective policy with the layer behind
each value, and judge staleness against the app's own interval. A legacy
`bay config s3 --keep N` is the global keep until `bay config backup --keep`
sets one.

**Lore sees backups without asking the bucket.** Each backup leaves a record on
the instance (key, trigger, tag, release, sizes, duration, and per database its
sha256, integrity, table count, five biggest tables and migration journals) and
is compared with the one before: a database that halves or disappears, a big
table emptied, a failed integrity check are reported as anomalies, never
refusals. The inventory carries it all in a `backup` block with one `state`
word (`unconfigured`, `restore-pending`, `off`, `failing`, `never`, `stale`,
`ok`), the bucket's health, the next scheduled run, the catalog counted at the
last listing, the last restore test and the last restore. The bucket is probed
every 5 minutes: three failures in a row is `down`, and a backup failure while
the bucket does not answer is a `target` failure rather than the app's.
What changes is also sent as events (`backup.*`: completed, failed,
anomaly, pruned, policy-changed; `restore.*`: completed, failed, auto, pending,
dismissed; `verify.passed|failed`; `target.down|up`), spooled in `connector-events.json`
(500 newest) and sent only to a Lore whose welcome lists the `events` feature.
The console's verbs are the CLI's, through the same functions:
`backup` (with a tag), `backups-list`, `backup-verify`, `target-probe`,
`backup-policy` (the operator layer, sent from the estate owner's console
only: a project declares its policy at deploy) and `restore` (a reason, or a
dry run).
The two writes are refused while the estate's `deployAllowed` is off, and a
restore and a deploy of one instance refuse each other with a 409.

A stack service is data too, so it declares how to dump itself in
`x-lore.backup`: `{postgres: {user, db}}` runs `pg_dump` in the service's
container and verifies with `pg_restore --list`, and `{command, restore}` takes
a command's stdout as the dump. Dumps ride the same schedule, upload and
pruning as the SQLite snapshot; an empty or failing hook is a failed backup.
The service's other files are not covered, and the response says so. A
volume no hook covers is named, by name, in every backup response, in
`bay status`, in `bay stack volumes` (with its size) and in the inventory
Lore reads: "not backed up: volume keycloak-data".

## Working on Bay

CI's `check` job runs the whole suite on every push, so the push covers you.
For the tighter loop, the same steps run in a Linux container, because that is
the only place the whole suite compiles:

```bash
./test-linux.sh   # gofmt, vet, build, tests, cross-compile - reproduces the CI job
```

`go test ./...` on a Mac runs most of the suite, including the tests that
drive a real Docker daemon (they skip without one, and fail instead under
`BAY_REQUIRE_DOCKER=1`, as in CI and `test-linux.sh`). The host gauge in
`internal/connector` is `//go:build linux`, so only the container covers it.
Docker must be running.

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
  headers/        the _headers reader, shared with the TS one through testdata/
  health/         "is this app serving?", which is not "is a port open?"
  manifest/       manifest.json reading and validation
  proxy/          host routing, statics, reverse proxy
  runner/         instance lifecycle - Docker containers, blue/green candidates
  runtimes/       which runtime image an archive runs in, pinned by digest
  s3/             the S3-compatible client backups and app storage share
  schedule/       when a backup is due, and when one is stale
  state/          one JSON document, atomic writes, kept at 0600
  tlsconf/        CertMagic wiring, ACME, private-CA trust for tests
```

## The artifact

Bay consumes the format the framework already produces:

```
example-api-latest.tar.zst
├── manifest.json         ← derived by `alepha build`
├── index.node.js         ← one entry per server slice
├── index.workerd.js
├── server/
│   ├── node/             ← each slice's chunks, namespaced
│   └── workerd/
├── public/
└── migrations/
```

The archive root is the contents: there is no `dist/` wrapper. An artifact may
carry several **server slices**, one per runtime it was linked for, and
`manifest.json` is the only thing that says which is which - there is no
`index.js` sniffing its host, because a second discovery mechanism able to
disagree with the manifest is worse than none.

Bay takes the **first slice it can run, in declared order**, applying no
preference of its own: `(node, bun)` spawns node and `(bun, node)` spawns bun,
from the same two slices. The build's declared order is the decision.

The slices are the manifest's `runtimes` list, and it is the only runtime
declaration: each entry names its runtime, its entry file and the runtime's
major, and a static site is one `static` slice with no entry. A manifest
without `runtimes` is refused by name and asks for a rebuild.

It arrives compressed with zstd. `.tar.gz` is read too, and is not going away:
hosts hold artifacts pulled before the change, and the compression is detected
from the stream's own first bytes rather than from the file name.

`manifest.json` is the contract between the build and all of its
consumers - `alepha deploy --prebuilt`, Lore Deploy, and Bay. Declaring
`$repository` is what puts `hasDatabase: true` in it, and that `true` is what
provisions the database **and** grants write access in the sandbox. Nobody
writes the same fact twice, so code ↔ infra drift is impossible by
construction.

⚠️ **An artifact needs a slice Bay can run.** A workerd bundle is resolved
against Cloudflare's export conditions and has no entry point node can execute,
so a workerd-only artifact is refused at deploy time and the message names what
it is - otherwise the app deploys, never boots, and the only message is "never
became ready". A `node` + `workerd` artifact is fine: Bay falls through to the
node slice.

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
`--since` and `--grep` (a regular expression). Entries come from the app
container's log, capped at three files of 10 MB.

⚠️ `--since` filters every line: one with no timestamp of its own takes Docker's.
Both filters run on the client over the last `-n` lines (200 by default, 2000 at
most), so widen `-n` for a longer window.

### The same two answers, on a page

A Bay connected to Lore pushes what `bay status --json` computes, on its
report interval and after every command that changes something, and Lore
renders it at `/account/estates/:estateId`. `computeStatus` is one function with two
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
