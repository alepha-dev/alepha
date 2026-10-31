# CLI reference

Every `bay` command, grouped by what it acts on, with its flags and defaults.
`bay` with no arguments prints the same list from the binary itself, which is
the final word for the version you run.

Every command below is a thin client of the control API, except `serve`,
`doctor`, `version`, `connector` and `stack exec`. A client runs on the host, as
root or a member of `bay-control`, and finds the socket from `BAY_SOCKET`, else
at `./bay-data/control.sock`. On a host installed with the guide's unit, run
`export BAY_SOCKET=/run/bay/control.sock`. `--control-socket PATH` overrides it
for one command.

An app instance is written `name/env`, a stack environment `stack/env`. A
stack's service is the instance `stack.service/env`, as in
`bay logs mcs.web/production`.

## Server

| Command     | Flags                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| `bay serve` | `--root ./bay-data` data directory                                                                          |
|             | `--addr :8080` HTTP listener, `--tls-addr :8443` HTTPS listener                                             |
|             | `--base-domain HOST` domain apps without their own are served under                                         |
|             | `--tls`, `--acme-email MAIL`, `--acme-ca URL`, `--acme-ca-root FILE.pem` (a private CA)                     |
|             | `--acme-http-port N`, `--acme-tls-port N` challenge ports, default 80 and 443                               |
|             | `--control-socket PATH`, `--control-group bay-control`                                                      |
|             | `--backup-interval 24h` (`0` disables), `--keep-releases 2` (minimum 2; per app, and stack revisions too)   |
| `bay doctor [--root /opt/bay/data] [--control-socket PATH]` | can this host run Bay; exits 1 on a failed check. On a live host pass the socket, or ports 80 and 443 fail |
| `bay version`              | the binary's version (`dev` for a local build)                                               |

## Apps

| Command                                                     | Does                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| `bay deploy (FILE\|-) [--name N] [--env E] [--domain D]... [--secrets-file F]` | deploy an artifact; `-` reads stdin            |
| `bay deploy --image REF@sha256:... --port N --name N [--health /path] [--env E] [--domain D]... [--secrets-file F]` | deploy a container image, by digest |
| `bay deploy <stack>/<env>/<service> (FILE\|-\|--image ...)`                 | deploy into a stack's app service                |
| `bay list`                                                  | every instance, as a JSON array                                          |
| `bay status [--json] [--backup-interval D]`                 | releases, process, traffic, backup freshness, warnings; exits 1 on a warning. `D` judges staleness against another schedule |
| `bay logs (<name/env>\|--name N [--env E]) [-n\|--lines 200] [--since 15m] [--grep RE] [--json]` | the container's log, at most 2000 lines; `--since` and `--grep` filter those on the client |
| `bay stop <name/env>`                                       | out of service until `start` or a deploy; survives reboots               |
| `bay start <name/env>`                                      | back into service                                                        |
| `bay remove <name/env> [--purge]`                           | unregister; data kept unless `--purge`                                   |
| `bay env set <name/env> (-\|FILE)`                          | merge `KEY=VALUE` lines; a changed value restarts the app               |
| `bay env list <name/env>`                                   | variable names only                                                      |
| `bay harden <name/env> --relax writable-rootfs[,capabilities]` | lift isolation defaults for this app; replaces the previous set       |
| `bay harden <name/env> --memory 1g\|default`                | memory ceiling, 64m to 64g (default 512m)                                |
| `bay harden <name/env> --clear`                             | remove every relaxation; the memory ceiling stays                        |

See [Deploying](/bay/docs/guides-deploying) and [Operating](/bay/docs/guides-operating).

## Runtimes and images

| Command                                   | Does                                                                |
| ----------------------------------------- | ------------------------------------------------------------------- |
| `bay runtimes`                            | pinned runtime images, and what each app runs                       |
| `bay runtimes update`                     | pull newer digests; restart the apps whose image moved             |
| `bay runtimes set <name/env> <image>`     | this app's own image, from its next start                           |
| `bay runtimes clear <name/env>`           | back to the image Bay picks                                         |
| `bay config registry-mirror (HOST\|--clear)` | pull Docker Hub images through a mirror                          |

## Backups and storage

| Command                                                                   | Does                                                       |
| ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `bay config s3:backups --endpoint URL --bucket B [--region R] [--keep 14]` | where backups go; keys from `BAY_S3_ACCESS_KEY`, `BAY_S3_SECRET_KEY` |
| `bay config s3:apps --endpoint URL --bucket B [--region R]`               | where apps store uploads; keys from `BAY_STORAGE_ACCESS_KEY`, `BAY_STORAGE_SECRET_KEY` |
| `bay config s3 --endpoint URL --bucket B [--region R] [--keep N]`         | both from one credential (warned about)                    |
| `bay backup <name/env>`                                                   | snapshot, verify, upload, now                              |
| `bay backups <name/env>`                                                  | stored snapshots                                           |
| `bay restore <name/env> [--key K]`                                        | restore the latest or a given snapshot; old DB set aside   |
| `bay backup list <stack>/<env> [service]`                                 | a stack's service dumps                                    |
| `bay backup restore <stack>/<env> <service> <backup> [--from S/E] [--yes]` | restore a service dump                                    |
| `bay storage migrate <name/env>`                                          | copy local uploads into the apps bucket, then repoint      |

See [Backups](/bay/docs/guides-backups).

## Stacks

| Command                                                              | Does                                                     |
| -------------------------------------------------------------------- | -------------------------------------------------------- |
| `bay stack deploy <stack>/<env> (DIR\|compose.yml\|ARCHIVE\|-) [--dry-run]` | apply a bundle as a new revision (none: reapply)  |
| `bay stack rollback <stack>/<env> --to N`                            | reapply revision N with the digests it pinned; `--keep-releases` prunes older revisions |
| `bay stack list`                                                     | every stack environment                                  |
| `bay stack ps <stack>/<env>`                                         | services, kind, state, domains                           |
| `bay stack logs <stack>/<env> <service> [-n 200]`                    | a service's log                                          |
| `bay stack restart <stack>/<env> <service>`                          | app services blue/green, others in place                 |
| `bay stack volumes <stack>/<env>`                                    | named volumes, sizes, and which no backup covers         |
| `bay stack exec <stack>/<env> <service> <cmd...>`                    | `docker exec -it` in a service: needs a terminal and Docker access |
| `bay stack env set\|list\|unset <stack>/<env> ...`                   | stack variables; values from stdin or a file             |
| `bay stack route <stack>/<env> <service> <domain>`                   | serve a full domain from a service                       |
| `bay stack route list\|remove <stack>/<env> ...`                     | list or remove routes                                    |
| `bay stack registry add <stack>/<env> HOST --username U`             | private registry; password from stdin                    |
| `bay stack registry list\|remove <stack>/<env> ...`                  | list or remove registries                                |
| `bay stack stop\|start <stack>/<env>`                                | durably out of service, or back                          |
| `bay stack destroy <stack>/<env> [--purge [--yes]]`                  | remove containers, routes and revisions; `--purge` also deletes volumes, variables and registries |

See [Stacks](/bay/docs/guides-stacks).

## Lore connector

These edit a file beside `state.json` directly, so they run as root with
`--root DIR` (or `BAY_ROOT`). They take `--control-socket PATH` (or `BAY_SOCKET`)
too: `set` and `clear` tell the running `bay serve` to re-read the file through
it, and `show` asks it for the connection state.

| Command                              | Does                                                |
| ------------------------------------ | --------------------------------------------------- |
| `bay connector set <lore-url> <secret>` | enrol this host as an estate                     |
| `bay connector show`                 | Lore URL, estate, connection state; never the secret |
| `bay connector clear`                | forget the Lore URL and secret                      |

See [Lore connector](/bay/docs/guides-lore-connector).

## Environment variables

| Variable                                          | Read by                          |
| ------------------------------------------------- | -------------------------------- |
| `BAY_SOCKET`                                      | client commands: control socket  |
| `BAY_ROOT`                                        | `bay connector`: data directory  |
| `BAY_S3_ACCESS_KEY`, `BAY_S3_SECRET_KEY`          | `bay config s3:backups`, `s3`    |
| `BAY_S3_ENDPOINT`, `BAY_S3_BUCKET`                | `bay config s3:backups`, when the flags are omitted |
| `BAY_STORAGE_ACCESS_KEY`, `BAY_STORAGE_SECRET_KEY` | `bay config s3:apps`            |
| `BAY_STORAGE_ENDPOINT`, `BAY_STORAGE_BUCKET`      | `bay config s3:apps`, when the flags are omitted |
| `DOCKER_HOST`                                     | `bay serve`, `bay doctor`: the Docker socket, `unix://` only; `tcp://` is refused |
