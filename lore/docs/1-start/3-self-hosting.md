# Self-hosting

Lore ships as one Docker image that runs on its own. There is no database to
install, no migration step and no seed command.

## Run it

```bash
docker run -p 3000:3000 -v lore:/data ghcr.io/alepha-dev/lore
```

That is the whole thing, with no environment variable to set. Open
`http://localhost:3000` and register.

Everything Lore stores lives in the `/data` volume. The image is built for
`linux/amd64`.

### Bind mounts and file ownership

The container runs as **uid 1000**, not root.

A **named volume** (`-v lore:/data`) inherits its ownership from the image,
which is set up for that user, and needs nothing.

A **bind mount** (`-v /srv/lore:/data`) does not: the host directory keeps its
own ownership, and the first write fails. Fix it on the host before starting
the container:

```bash
sudo mkdir -p /srv/lore
sudo chown 1000:1000 /srv/lore
```

If you do not need a bind mount, a named volume is the simpler answer.

## What happens on first boot

None of this is a malfunction:

- **The database is created and migrated** at `/data/lore.db`. A self-hosted
  Lore runs on SQLite, so there is no separate database to run.
- **A unique `APP_SECRET` is generated** into `/data/.app_secret`, mode `0600`.
  It signs sessions and tokens, and every install gets its own: a secret baked
  into a public image would be shared by all of them. It is generated again
  only if you delete it, which would sign every existing session out.
- **Registration is open, and the first account to register becomes the
  administrator.** Everyone who registers afterwards is an ordinary member.
- **Files, emails and analytics all live under `/data`**, because nothing
  external is configured yet.

The container says so in its own log while no account exists:

```txt
WARN No accounts exist. Registration is open and the first account will become the administrator.
```

> ⚠️ **Create the first account before the instance is reachable from the
> internet.**
>
> Whoever registers first becomes the administrator. On a laptop or inside a
> private network that does not matter. On a host that already resolves
> publicly, a stranger can take the instance while you are still reading this
> page. Start it, register, and only then put it behind a public address.

Once your account exists:

1. Open **Admin ▸ Parameters** and set `registrationAllowed` to `false`.
2. Invite people by email from a project's **Settings ▸ Members**. An
   invitation carries a token that works on a closed instance, so closing
   registration does not shut out the people you invite. See
   [Members](/lore/docs/project-members).

## Configuration

Nothing is required. Each group of variables below turns on one thing, which
stays off until the group is set.

### ⚠️ Some variables freeze at first boot

Lore keeps its registration and sign-in settings in its database, so an
administrator can change them from **Admin ▸ Parameters** without a restart.
The environment variables that map onto those settings are **first-boot
defaults**: the first time an administrator opens **Admin ▸ Parameters**,
every one of these settings is saved, and from that moment the saved value
wins over the environment.

That covers `REGISTRATION_ALLOWED`, `ADMIN_EMAIL`, `TURNSTILE_SITE_KEY` and the
two settings derived from the email configuration (`verifyEmailRequired` and
`resetPasswordAllowed`).

**Adding one of them to a running instance does nothing.** Adding a mail server
a week after setup means setting `EMAIL_HOST` _and_ turning email verification
and password reset on in **Admin ▸ Parameters**. Otherwise it looks as if the
container ignores its environment.

Everything else on this page (`DATABASE_URL`, `S3_*`, the sign-in provider
credentials, `SERVER_PORT`) is read on every boot and is not affected.

### Email

| Variable       | Default | Description                                    |
| -------------- | ------- | ---------------------------------------------- |
| `EMAIL_HOST`   | -       | SMTP host. Setting it enables all of the below |
| `EMAIL_PORT`   | `587`   | SMTP port                                      |
| `EMAIL_USER`   | -       | SMTP username                                  |
| `EMAIL_PASS`   | -       | SMTP password                                  |
| `EMAIL_FROM`   | -       | Default sender address                         |
| `EMAIL_SECURE` | `false` | Use TLS on connect                             |

With no `EMAIL_HOST` there is no email verification and no password reset. Both
finish by sending a code, so both stay off: otherwise a new account would wait
on a "check your inbox" screen forever.

`EMAIL_ENABLED` overrides that judgement in either direction. It is for a setup
whose mail transport the container cannot see for itself: mail relayed by a
sidecar, or read straight out of `/data/emails` by an operator who is happy to
do that. Setting it does **not** configure a transport. It only says one exists.

Mail that would have been sent is still written to disk, one JSON file per
recipient under `/data/emails`. That is the way out when someone needs a link
and there is no mail server:

```bash
docker exec <container> ls /data/emails
```

### Sign-in providers

| Variable                                    | Description         |
| ------------------------------------------- | ------------------- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Sign in with Google |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Sign in with GitHub |

Both halves of a pair are needed. With either missing, the provider is not
offered and its button does not appear, so a half-configured provider is
invisible, not broken.

### Object storage

| Variable               | Description                                                        |
| ---------------------- | ------------------------------------------------------------------ |
| `S3_ENDPOINT`          | S3-compatible endpoint. Setting it switches storage off the volume |
| `S3_BUCKET_NAME`       | Bucket holding every uploaded file                                 |
| `S3_ACCESS_KEY_ID`     | Access key                                                         |
| `S3_SECRET_ACCESS_KEY` | Secret key                                                         |

Without these, avatars, project icons and the files attached to folios and
quests all live under `/data`, which is where the backup already is.

### Captcha

| Variable               | Description                                  |
| ---------------------- | -------------------------------------------- |
| `TURNSTILE_SITE_KEY`   | Public site key, shown in the widget         |
| `TURNSTILE_SECRET_KEY` | Secret key, used to verify a submitted token |

⚠️ Set **both**. The site key alone turns the requirement on and shows the
widget. Without the secret key every submission is refused.

### Overrides

| Variable               | Default                   | Description                                       |
| ---------------------- | ------------------------- | ------------------------------------------------- |
| `APP_SECRET`           | generated into `/data`    | Signing secret. Set it to manage the key yourself |
| `DATABASE_URL`         | `sqlite:///data/lore.db`  | Database location                                 |
| `SERVER_PORT`          | `3000`                    | Port inside the container                         |
| `ADMIN_EMAIL`          | -                         | An address always granted admin                   |
| `REGISTRATION_ALLOWED` | `true`                    | Whether strangers may register                    |
| `EMAIL_ENABLED`        | derived from `EMAIL_HOST` | Whether mail can leave this instance              |

> ⚠️ **`REGISTRATION_ALLOWED=false` is honoured from first boot, except while
> no account exists.**
>
> A fresh instance with registration closed has no administrator, and creating
> one is the very thing that is closed, so it could never be opened again from
> the browser. Lore therefore keeps registration reachable until the first
> account exists, and logs a warning each time that rule applies. Closing an
> instance is one click in **Admin ▸ Parameters** once you have an account, and
> that is the route to prefer.

## Behind a reverse proxy

The container serves plain HTTP. Put HTTPS in front of it for anything
reachable from the internet: secure cookies and OAuth redirects both need it.

The proxy has to forward the original host and protocol. Otherwise Lore builds
its links from what the proxy sees, and OAuth callbacks land nowhere:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
}
```

## Backup

`/data` is the entire state: the database, the signing secret, uploaded files
and any mail on disk. Backing up means copying the volume.

```bash
docker run --rm -v lore:/data -v "$PWD:/backup" alpine \
  tar czf /backup/lore-backup.tar.gz -C /data .
```

Restoring is the same command in reverse, into an empty volume, with the
container stopped.

⚠️ **`/data/.app_secret` seals every secret Lore stores**: the environment
variables of every app instance, registry credentials, and the `APP_SECRET` of
every app running on a Bay machine, which Lore keeps so that a rebuilt machine
gets its keys back. Losing that file loses every sealed value at once. A Lore
image running on Bay is not backed up by Bay either, since the image has no
database Bay can snapshot. Back the volume up yourself, and keep a copy of
`/data/.app_secret` somewhere apart from the machine.

## Upgrading

Take a backup, pull the new tag and restart. Migrations run on boot.

```bash
docker pull ghcr.io/alepha-dev/lore:latest
docker stop lore && docker rm lore
docker run -d --name lore -p 3000:3000 -v lore:/data ghcr.io/alepha-dev/lore:latest
```

Images are tagged `:<version>` and `:latest`, nothing else. Pin a version if
you prefer to choose when to move.

⚠️ **Downgrading is not supported once a migration has run.** An older image
does not know how to undo a newer schema, and there is no down-migration. The
backup you took before the upgrade is the way back.

### Which image goes with a given version

Every release page on [lore.alepha.dev](https://lore.alepha.dev) has an
**Artifacts** tab. From version 0.30.0 on, the image is listed there beside the
packed builds, with its `docker pull` line ready to copy. Look there when you
want the image for one specific version instead of whatever `:latest` points
at: the tag on the page and the tag in the registry are the same.

## Health

The image declares a `HEALTHCHECK` on `/health`, which answers 503 until Lore
has migrated its database and is ready. `docker ps` shows the container
`healthy` a few seconds after it starts, and Compose can wait for it:

```yaml
services:
  lore:
    image: ghcr.io/alepha-dev/lore
    volumes: [lore:/data]
  proxy:
    image: nginx
    depends_on:
      lore:
        condition: service_healthy
volumes:
  lore:
```

## What the image contains

Each release of the image carries its evidence, for a security review or an
SBOM requirement:

- **An SBOM attestation** (SPDX) listing the base image's packages and the npm
  packages bundled into Lore, plus the build's own CycloneDX list inside the
  image at `/app/sbom.cdx.json`.
- **A provenance attestation** (SLSA), recording how and from which commit the
  image was built.

Read them from the registry, without pulling the image:

```bash
docker buildx imagetools inspect ghcr.io/alepha-dev/lore:latest --format '{{json .SBOM}}'
docker buildx imagetools inspect ghcr.io/alepha-dev/lore:latest --format '{{json .Provenance}}'
```

## Next

- [Quickstart](/lore/docs/start-quickstart): your account, a project and a
  first quest.
- [Members](/lore/docs/project-members): invite your team.
- [The lore CLI](/lore/docs/reference-cli): point it at your instance with
  `LORE_URL`.
- [Assistant](/lore/docs/agents-assistant): why it stays off on a self-hosted
  instance.
