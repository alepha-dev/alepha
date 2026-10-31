# Backups

Bay snapshots every app's SQLite database to an S3-compatible bucket on a
schedule, verifies each snapshot, prunes old ones, and restores the latest one
on its own when an app is redeployed onto an empty machine.

**Backups cover the database and nothing else**, and every backup response says
so in words. Uploads and `.env` are never archived: uploads are made durable by
putting them in a bucket, and the secrets a project declares come from the
deploy. A backup system's worst failure is somebody believing it covers more
than it does.

| Data                  | Covered                     | How it survives the host                                                 |
| --------------------- | --------------------------- | ------------------------------------------------------------------------ |
| the app's SQLite file | yes                         | scheduled snapshots in the backups bucket                                |
| `storage/` (uploads)  | no                          | `bay config s3:apps` + `bay storage migrate`: uploads live in a bucket   |
| `.env`, secrets       | no                          | declared secrets are redeployed from the project (`.env.<env>`, `alepha deploy`); [the rest is lost](#disaster-recovery) |
| a stack service       | when it declares a hook     | `x-lore.backup`, see [Stacks](/bay/docs/guides-stacks#backups-and-volumes) |
| an image app          | no database to back up      | no host path is mounted: keep state in a stack service or a bucket       |

## Where backups go

Bay knows two S3 targets, named by who uses them. These commands, and every
other `bay` command on this page, run on the host with `BAY_SOCKET` set, as in
[Operating](/bay/docs/guides-operating):

```bash
export BAY_SOCKET=/run/bay/control.sock

# where BACKUPS go; never handed to an app
BAY_S3_ACCESS_KEY=... BAY_S3_SECRET_KEY=... \
  bay config s3:backups --endpoint https://<account>.r2.cloudflarestorage.com --bucket bay-backups --keep 14

# where hosted APPS put their uploads; given to every app that declares a bucket
BAY_STORAGE_ACCESS_KEY=... BAY_STORAGE_SECRET_KEY=... \
  bay config s3:apps --endpoint https://<account>.r2.cloudflarestorage.com --bucket bay-uploads
```

Credentials come from the environment, never the command line, where `ps`
would show them to every user on the machine. `--region` defaults to `auto`
(right for R2); `--keep` is the number of snapshots kept per app, 14 by
default. Neither target needs a Bay restart: `s3:backups` applies from the next
backup, and `s3:apps` reaches an app's `.env` at its next deploy. That deploy is
refused for an app with files in `storage/` until
[`bay storage migrate`](#moving-uploads-to-a-bucket) has run.

⚠️ **Use two credentials.** `bay config s3` sets both targets from one key: it
is convenient, and any hosted app given that key can then delete every backup.
Bay warns when you use it, and `bay status` flags it for as long as it lasts.
Scope the backup key to the backup bucket alone.

## The schedule

`bay serve` takes a snapshot of every app every `--backup-interval`, **24 hours**
by default (`0` disables it). Until `bay config s3:backups` names a bucket the
schedule does nothing and logs nothing; `bay status` shows `backup NEVER`. Each
run:

1. snapshots the live database, in the app's own runtime image so the SQLite
   that reads it is the one that wrote it;
2. verifies the copy with `PRAGMA integrity_check`;
3. gzips it and uploads it as `apps/<name>-<env>/db/<timestamp>.sqlite.gz`;
4. prunes the app's snapshots down to `--keep`.

A snapshot is compressed, not encrypted: whoever reads the bucket reads the
database.

`bay status` shows each app's last backup and its age. It warns when the last
one is older than **twice** the interval, when no backup was ever taken, and
when the last attempt failed, with the reason. A once-late run does not warn;
a stopped schedule does.

## By hand

```bash
bay backup  myapp/production                      # snapshot + verify + upload, now
bay backups myapp/production                      # what is stored, newest first
bay restore myapp/production                      # the latest
bay restore myapp/production --key apps/myapp-production/db/20261101T030000Z.sqlite.gz
```

`bay restore` is **destructive**: it replaces the live database. The one it
replaces is not deleted but set aside beside it, as
`app.db.before-restore-<timestamp>` (with its WAL and SHM files), so a restore
of the wrong snapshot can itself be undone by hand.

## Disaster recovery

When Bay creates a database for an app, because the machine is new or its disk
was lost, and a backup of that app exists, Bay **restores the latest snapshot
before the app starts**. It never does so over an existing database.

So recovering from a lost host is:

1. [Install Bay](/bay/docs/guides-installation) on a new machine.
2. Configure the same backups bucket (and apps bucket) with `bay config`.
3. Point DNS at the new machine, and redeploy each app with
   `alepha deploy --env production`.

Each app comes back with its data as of its last snapshot, the secrets the
deploy carries and its uploads from the apps bucket. What does not come back:

- **`APP_SECRET`.** It lives only in the instance's `.env`, and neither a deploy
  nor `bay env set` can write it, so the new host generates a new one and every
  user is signed out.
- **Values set with `bay env set`.** They were in that `.env` too: set them
  again.
- **Uploads that were on the old host's disk only**, which is why the next
  section exists.
- **Stacks.** Recovery covers apps only. A stack's variables, routes and registry
  credentials are in no bucket, and its dumps are never restored on their own:
  put the variables and credentials back, run `bay stack deploy`, add the routes,
  then `bay backup restore` each service.
- **The Lore connector.** `connector.json` is in no bucket: run
  `bay connector set` again.

A failed restore does not fail the deploy: the app starts on an empty database,
and nothing retries, because a database now exists. `bay deploy` says so under
`restore.database` (`empty (...)`), but `alepha deploy` prints only the URL, so
check the data after a recovery. Within a minute the schedule snapshots that
empty database and it becomes the latest, so find the last good snapshot with
`bay backups` and restore it with `bay restore --key`.

## Moving uploads to a bucket

An app that stores files ([`$storage`](/docs/guides-persistence-storage)) writes them under `storage/` on the host's
disk until an apps bucket is configured. Those files exist in one place, and
`bay backup` names them as not covered. To move them:

```bash
bay config s3:apps --endpoint ... --bucket bay-uploads   # once per host
bay storage migrate myapp/production
```

`migrate` stops the app, copies its local files into the bucket, repoints it at
the bucket and starts it again, so the app is down for the length of the copy.
The local copies are **kept** for you to delete once you have checked the app.
Enable versioning on the bucket if you want point-in-time recovery of uploads:
object storage keeps the current blob, not yesterday's.
