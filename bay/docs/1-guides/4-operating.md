# Operating

Day-to-day commands on a Bay host: what is running and how healthy it is, an
app's logs and environment, taking an app out of service, runtime images and
per-app isolation.

The commands below are thin clients of Bay's control API, and run **on the
host**: over SSH, as root or as a member of `bay-control`. They look for the
socket at `./bay-data/control.sock`, so on an installed host name it once for
the session:

```bash
export BAY_SOCKET=/run/bay/control.sock
```

Over SSH the variable goes in the remote command, as the samples show. From a
project, `alepha infra status --env production` shows the project's instance
remotely, from `bay list` and `bay env list`; the warnings below come from
`bay status` only.

## Status

```bash
bay list             # every app instance, as a JSON array
bay status           # releases, process, traffic and backups, per app
bay status --json    # the same, for a script
```

`bay status` is where trouble shows up first, and it exits with status 1 on any
warning. `--json` exits 1 on the same rows except the last two, and lists them
as each entry's `problems`. Each warning names what to do:

| Warning                                                    | Meaning                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `process ⚠ NOT RUNNING`                                    | the app is down, crashed or stopped on purpose alike                                        |
| `⚠ restarted N time(s)`                                    | the container keeps dying: read its logs                                                    |
| `⚠ stale — expected every 24h0m0s`                         | no backup in twice the backup interval, or none ever                                        |
| `⚠ last attempt failed: ...`                               | the last backup failed, with the reason                                                     |
| `⚠ scheduled backups are held after a failed restore: ...` | a deploy could not restore this app: `bay restore` it, or `bay backup` to keep its database |
| `⚠ isolation relaxed: ...`                                 | `bay harden --relax` is in force for this app                                               |
| `⚠ apps and backups share ONE credential`                  | `bay config s3` was used: see [Backups](/bay/docs/guides-backups#where-backups-go)          |

## Logs

```bash
bay logs myapp/production                 # last 200 lines
bay logs myapp/production -n 1000
bay logs myapp/production --since 15m --grep 'ERROR|WARN'
bay logs myapp/production --json          # a JSON array of lines
```

This is the app container's output. Bay caps it at three files of 10 MB per
app, so a chatty app cannot fill the disk. `--since` and `--grep` filter on the
client, over the last `-n` lines (200 by default, 2000 at most), so widen `-n`
for a longer window. A line with no timestamp of its own takes Docker's, so
`--since` filters it like any other.

## Environment variables

```bash
ssh HOST 'BAY_SOCKET=/run/bay/control.sock bay env set myapp/production -' < .env.production
bay env list myapp/production
```

`bay env set` merges `KEY=VALUE` lines into the instance's `.env`. Values are
read from **stdin or a file, never from the command line**: an argument is
visible in `ps` to every user on the machine.

- A key whose value actually changes **restarts the app**: an environment
  variable the process never sees has not been set.
- Keys Bay owns (`NODE_ENV`, `APP_SECRET`, `DATABASE_URL`, `SERVER_PORT`,
  `SERVER_HOST`, `APP_NAME`, `DATA_DIR`, `STORAGE_PATH`, `S3_*`) are refused,
  not overwritten.
- `bay env list` prints names only, never values.

Secrets the project declares travel with `alepha deploy` instead, so the app
never boots without them: see [Deploying](/bay/docs/guides-deploying#environment-and-secrets).

## Stopping and starting

```bash
bay stop myapp/staging      # out of service
bay start myapp/staging     # back
```

A stop is **durable**: it survives a reboot and a Bay upgrade, and the app stays
dark until `bay start` or the next deploy, which clears it. Starting an app
that is already running does nothing. To delete an app rather than park it,
see [Removing an app](/bay/docs/guides-deploying#removing-an-app).

## Runtimes

An archive app runs in `node:<major>-slim` or `oven/bun:<major>-slim`, the major
its manifest records. Bay pins each image by digest, and the digests ship with
each Bay release, so upgrading Bay restarts apps on the new pins. `bay runtimes
update` records newer digests of its own, and those win over the release's.

```bash
bay runtimes                                 # pinned images, and what each app runs
bay runtimes update                          # pull newer digests, restart the apps whose image moved
bay runtimes set myapp/production node:24-slim@sha256:...   # this app's own image
bay runtimes clear myapp/production          # back to the image Bay picks
```

An image set with `runtimes set` takes effect at the app's next start, and
`runtimes update` leaves it alone. A major Bay has no image for is refused at
deploy.

Behind a company proxy or to avoid Docker Hub's rate limits, route image pulls
through a mirror:

```bash
bay config registry-mirror mirror.example.com   # postgres:17 → mirror.example.com/library/postgres:17
bay config registry-mirror --clear
```

## Isolation and memory

An archive app runs locked down by default:

| Default                       | Why                                                                    |
| ----------------------------- | ---------------------------------------------------------------------- |
| its own uid (from 20000 up)   | one compromised app cannot read another's files on disk                 |
| no Linux capabilities         | nothing an Alepha app needs                                             |
| read-only root filesystem     | code cannot be rewritten at runtime; `/tmp` is a 64 MB tmpfs           |
| 512 MB memory ceiling         | a leaking app is killed and restarted, not the host                     |

The uid separates files on disk and nothing else: every app that declares a
bucket holds the same S3 key, with only `S3_KEY_PREFIX` differing, and standalone
apps share Docker's default bridge network, so one can reach another's port.

An app that needs more lifts one constraint, for itself only:

```bash
bay harden myapp/production --relax writable-rootfs
bay harden myapp/production --relax writable-rootfs,capabilities
bay harden myapp/production --memory 1g       # 64m to 64g
bay harden myapp/production --memory default
bay harden myapp/production --clear          # every relaxation removed
```

The app restarts with the change, and `bay status` flags a relaxation for as
long as it lasts. Each `--relax` replaces the previous set, and `--clear` leaves
the memory ceiling alone. An image app gets only the memory ceiling from this
table: it keeps its image's user, Docker's default capabilities and a writable
root filesystem, and `--relax` refuses it.

## Checking the host

```bash
sudo bay doctor --control-socket /run/bay/control.sock
```

One line per check: Docker reachable and at least 25 (API 1.44), cgroup v2, the
compose plugin, ports 80 and 443, free disk. It exits with status 1 when one
fails, so it fits a monitoring script. It needs no running Bay, and on a live
host it needs the socket, which it dials: if no Bay answers there, ports 80 and
443 read as held by another program, and both checks fail. Before the first
start, `sudo bay doctor` is enough.

With S3 configured it also reaches each bucket and reads its versioning. It
writes nothing there: keys shared between apps, or the backup key also held by
the apps, show as `WARN` lines that do not change the exit status.
`--probe-keys` re-proves every key with write probes: each app's own key, which
fails if it is no longer isolated, and the host-wide apps key, tried against
every app's backups, which warns.

## Troubleshooting

| Symptom                                                        | Cause and fix                                                                                         |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `no control socket found`                                      | the socket is not at `./bay-data/control.sock`: `export BAY_SOCKET=/run/bay/control.sock`             |
| `connect: permission denied` on the socket                    | the user is not in `bay-control`, or the SSH session predates it: reconnect (`ssh -O exit HOST`)      |
| `control api unreachable` as root                              | `bay serve` is not running: `systemctl status bay`, `journalctl -u bay`                               |
| `bay: command not found` over SSH, fine interactively          | `bay` is not on the non-interactive PATH: `ln -s /opt/bay/bin/bay /usr/local/bin/bay`                 |
| `too old to read the deploy artifact from stdin`               | the host's Bay is older than the CLI: [upgrade it](/bay/docs/guides-installation#upgrading-bay)       |
| `does not know --secrets-file`                                 | the same: upgrade Bay                                                                                 |
| `no secrets file at /tmp/...`                                  | the unit has `PrivateTmp=yes`: remove it                                                              |
| deploy answers `502` after a while                             | the release never reported `ready: true` in 60 s; `bay logs` shows why, and the previous one serves   |
| "too many redirects" behind Cloudflare                         | SSL mode is Flexible: set Full (strict)                                                               |
| `⚠ restarted N time(s)` in `bay status`                        | the app crashes after boot: `bay logs`; raise `--memory` if it is killed for memory                   |
