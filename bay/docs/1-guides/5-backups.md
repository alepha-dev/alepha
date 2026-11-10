# Backups

Bay snapshots every app's SQLite database to an S3-compatible bucket on a
schedule, verifies each snapshot, prunes old ones, and restores the latest one
on its own when an app is redeployed onto an empty machine.

**Backups cover the database and the key it was sealed with, and nothing
else**, and every backup response says so in words. Uploads and the rest of
`.env` are never archived: uploads are made durable by putting them in a
bucket, and the secrets a project declares come from the deploy. A backup system's worst failure is somebody believing it covers more
than it does.

| Data                  | Covered                     | How it survives the host                                                 |
| --------------------- | --------------------------- | ------------------------------------------------------------------------ |
| the app's SQLite file | yes                         | scheduled snapshots in the backups bucket                                |
| `APP_SECRET`          | yes, with the database      | each snapshot carries it; a host connected to Lore also gets it from Lore. [See below](#the-signing-key) |
| `storage/` (uploads)  | no                          | `bay config s3:apps` + `bay storage migrate`: uploads live in a bucket   |
| the rest of `.env`    | no                          | declared secrets are redeployed from the project (`.env.<env>`, `alepha deploy`); [the rest is lost](#disaster-recovery) |
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
# and has no key of its own (see below)
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

**One upload key per app.** The host-wide `s3:apps` key goes into every app's
`.env`, so with it alone any app can read and delete the others' uploads.
`bay config s3:apps <name/env> --endpoint … --bucket …` gives one instance a key
of its own (same variables), stored only once S3 itself proves it: the key must
write under `apps/<name>-<env>/blobs/` and be refused on the backups (its own,
`apps/<name>-<env>/db/`, included) and every other app's prefix, for listing,
reading, writing and deleting alike. Scope it to `apps/<name>-<env>/blobs/`, not
`apps/<name>-<env>/`: when backups share the bucket, the wider scope can delete
the app's own backups, and Bay refuses it. R2 scopes a token to a bucket, not a prefix, so there
isolation means one bucket per app. `--check` re-runs the proof, `--clear`
falls back to the host-wide key.

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
database, and the app's `APP_SECRET` beside it, which signs its sessions and
seals its MFA secrets. **Read access to the backups bucket is as sensitive as
access to the host.**

`bay status` shows each app's last backup and its age. It warns when the last
one is older than **twice** the interval, when no backup was ever taken, and
when the last attempt failed, with the reason. A once-late run does not warn;
a stopped schedule does. It also warns while scheduled backups are held after a
[failed restore](#disaster-recovery).

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

Each app comes back with its data as of its last snapshot, the `APP_SECRET`
that data was sealed with, the secrets the deploy carries and its uploads from
the apps bucket. What does not come back:

- **Values set with `bay env set`.** They were in that `.env` too: set them
  again.
- **Uploads that were on the old host's disk only**, which is why the next
  section exists.
- **Stacks.** Recovery covers apps only. A stack's variables, routes and registry
  credentials are in no bucket, and its dumps are never restored on their own:
  put the variables and credentials back, run `bay stack deploy`, add the routes,
  then `bay backup restore` each service. A stack's app services have no
  snapshot to carry their `APP_SECRET`: connected to Lore they get it back from
  Lore on their first deploy; without Lore they get a new one.
- **The `APP_SECRET` of an app Bay does not back up** (one on its own
  `DATABASE_URL`, or with no database), for the same reason: Lore gives it back
  on a host connected to it, and a host without Lore mints a new one.
- **The Lore connector.** `connector.json` is in no bucket: run
  `bay connector set` again.

A failed restore does not fail the deploy: the app starts on an empty database,
and nothing retries, because a database now exists. The deploy says so:
`alepha deploy` prints a warning, and `bay deploy` answers `restore.warning`.
Scheduled backups of that app are held, so the snapshot it missed stays the
latest, and `bay status` flags the hold. Run `bay restore myapp/production` to
bring it back, or `bay backup myapp/production` to keep the database the app has
now. Either one ends the hold. Bay holds only when a snapshot may exist: an app
with an empty bucket, or none configured, starts empty and backs up as usual.

## The signing key

Bay mints an app's `APP_SECRET` on its first deploy. It signs sessions and
links, and the framework seals MFA secrets with it, so a database restored
under another key comes back broken: every user signed out, and every user
with MFA locked out.

So a snapshot carries the key, as an object of its own beside the databases
(`apps/<name>-<env>/db/<stamp>/app-secret`; the manifest records only its
SHA-256). A deploy never changes the key of an instance that already has one.
An instance without one takes it in this order:

1. **the snapshot being restored into it**, because it is the key the restored
   rows were sealed with;
2. **the key Lore holds for the app**, on a host connected to Lore. Bay sends
   Lore the key each instance runs on, so Lore's copy follows the machine;
3. **a new key**, minted.

Every deploy says which it was (`kept`, `snapshot`, `lore` or `minted`), in
what `alepha deploy` prints, in `bay deploy`'s answer and in `bay status`. A
key minted over data the restore brought back is a **warning**, not a log
line, and `bay status` flags the instance until its next deploy: the data is
back, and every MFA user is locked out of it.

**A bucket configured after the first deploy.** The deploy on a fresh host
before `bay config s3:backups` starts the app empty, on a new key, and holds
its backups. The `bay restore` that ends the hold brings back the snapshot's
key with its data, so sessions signed in that window are signed out, and the
restore says so. A restore from a snapshot that predates keys in snapshots
leaves the instance on the new key, and warns.

**Outside that window**, a restore keeps the instance's key, and says when the
snapshot was sealed with another one. To restore a snapshot's key together
with its databases, on purpose:

```bash
bay restore myapp/production --key 20261101T030000Z --with-key
```

It asks for confirmation (or `--yes`), signs every session out, and is refused
with `--from`: another instance's key never comes with its data. To put back a
key you kept somewhere (a host rebuilt before snapshots carried keys), see
[`bay secret replace`](/bay/docs/guides-operating#replacing-the-signing-key).

`bay backup verify` says whether a snapshot carries a key, and `bay doctor`
whether the latest one carries the key the instance runs on.

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
