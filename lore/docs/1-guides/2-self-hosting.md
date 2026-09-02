# Self-Hosting

```bash
docker run -p 3000:3000 -v lore:/data ghcr.io/alepha-dev/lore
```

That is the whole thing. No environment variables, no migration step, no seed command. Open `http://localhost:3000` and register.

## What Happens on First Boot

None of this is a malfunction:

- **The database is created and migrated** at `/data/lore.db`. Lore self-hosts on SQLite; there is no separate database to run.
- **A unique `APP_SECRET` is generated** into `/data/.app_secret`, mode `0600`. It signs sessions and tokens, and it is regenerated only if you delete it, which would sign every existing session out. A public image cannot ship a baked secret: it would be one token-forgery key shared by every install in the world.
- **Registration is open, and the first account to register becomes the administrator.** Everyone who registers afterwards is an ordinary member.
- **Files, emails and analytics all live under `/data`**, because nothing external is configured yet.

The container says so in its own log while no account exists:

```txt
WARN No accounts exist. Registration is open and the first account will become the administrator.
```

> **Create the first account before the instance is reachable from the internet.**
>
> Whoever registers first becomes the administrator. On a laptop or inside a private network that is a non-event; on a host that already resolves publicly it means a stranger can take the instance while you are still reading this page. Start it, register, and only then put it behind a public address.

Once your account exists:

1. Open **Admin ▸ Parameters** and set `registrationAllowed` to `false`.
2. Invite people by email from the project's Members settings. An invitation carries a token that works against a closed instance, so closing registration does not close the door on people you invite.

## ⚠️ Environment Variables Freeze at First Boot

Lore stores its realm settings in the database so the owner can change them without a redeploy. The environment variables below that map onto those settings are **boot-time defaults**: the first time an administrator opens the Parameters page, the whole settings object is written to a row, and from that moment the row wins.

That covers `REGISTRATION_ALLOWED`, `ADMIN_EMAIL`, `TURNSTILE_SITE_KEY` and the two settings the email configuration derives (`verifyEmailRequired`, `resetPasswordAllowed`).

**Adding one of them to a running instance does nothing.** Adding SMTP a week after setup means setting `EMAIL_HOST` _and_ turning email verification and password reset back on in admin. Without knowing this, an operator concludes the container ignores its environment.

Everything else on this page (`DATABASE_URL`, `S3_*`, the OAuth credentials, `SERVER_PORT`) is read on every boot and is not affected.

## Configuration

Nothing is required. Each group buys one capability, and stays off until it is set.

### Email

| Variable       | Default | Description                                    |
| -------------- | ------- | ---------------------------------------------- |
| `EMAIL_HOST`   | -       | SMTP host. Setting it enables all of the below |
| `EMAIL_PORT`   | `587`   | SMTP port                                      |
| `EMAIL_USER`   | -       | SMTP username                                  |
| `EMAIL_PASS`   | -       | SMTP password                                  |
| `EMAIL_FROM`   | -       | Default sender address                         |
| `EMAIL_SECURE` | `false` | Use TLS on connect                             |

With no `EMAIL_HOST` there is no email verification and no password reset: both complete by sending a code, so both stay off rather than parking a new account on a "check your inbox" screen forever.

`EMAIL_ENABLED` overrides that judgement in either direction. It is for a setup whose transport the container cannot see for itself: mail relayed by a sidecar, or read straight out of `/data/emails` by an operator who is happy to do that. Setting it does **not** configure a transport; it only says one exists.

Mail that would have been sent is still written to disk, one JSON file per recipient under `/data/emails`. That is the escape hatch when something needs a link and there is no mail server:

```bash
docker exec <container> ls /data/emails
```

### Sign-in Providers

| Variable                                    | Description         |
| ------------------------------------------- | ------------------- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Sign in with Google |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Sign in with GitHub |

Both halves of a pair are needed. With either missing the provider is not advertised at all and its button does not render, so a half-configured provider is invisible rather than broken.

### Object Storage

| Variable               | Description                                                        |
| ---------------------- | ------------------------------------------------------------------ |
| `S3_ENDPOINT`          | S3-compatible endpoint. Setting it switches storage off the volume |
| `S3_BUCKET_NAME`       | Bucket holding every uploaded file                                 |
| `S3_ACCESS_KEY_ID`     | Access key                                                         |
| `S3_SECRET_ACCESS_KEY` | Secret key                                                         |

Absent, avatars, project icons, folio blobs and attachments all live under `/data`, which is where the backup already is.

### Captcha

| Variable               | Description                                  |
| ---------------------- | -------------------------------------------- |
| `TURNSTILE_SITE_KEY`   | Public site key, rendered in the widget      |
| `TURNSTILE_SECRET_KEY` | Secret key, used to verify a submitted token |

Set **both**. The site key alone is what turns the requirement on and renders the widget; without the secret key every submission is refused.

### Overrides

| Variable               | Default                   | Description                                       |
| ---------------------- | ------------------------- | ------------------------------------------------- |
| `APP_SECRET`           | generated into `/data`    | Signing secret. Set it to manage the key yourself |
| `DATABASE_URL`         | `sqlite:///data/lore.db`  | Database location                                 |
| `SERVER_PORT`          | `3000`                    | Port inside the container                         |
| `ADMIN_EMAIL`          | -                         | An address always granted admin                   |
| `REGISTRATION_ALLOWED` | `true`                    | Whether strangers may register                    |
| `EMAIL_ENABLED`        | derived from `EMAIL_HOST` | Whether mail can leave this instance              |

> **`REGISTRATION_ALLOWED=false` is honoured from first boot, except while no account exists.**
>
> A fresh instance with registration closed has no administrator, and creating one is the very thing that is closed, so it could never be opened again through the UI. Lore therefore keeps registration reachable until the first account exists, and logs a warning each time that rule applies. Closing an instance is a one-click operation in admin once you have an account; that is the route to prefer.

## Backup

`/data` is the entire state: the database, the signing secret, uploaded files and any mail on disk. Backing up means copying the volume.

```bash
docker run --rm -v lore:/data -v "$PWD:/backup" alpine \
  tar czf /backup/lore-backup.tar.gz -C /data .
```

Restoring is the same command in reverse, into an empty volume, with the container stopped.

## Upgrading

Pull the new tag and restart. Migrations run on boot.

```bash
docker pull ghcr.io/alepha-dev/lore:latest
docker stop lore && docker rm lore
docker run -d --name lore -p 3000:3000 -v lore:/data ghcr.io/alepha-dev/lore:latest
```

Images are tagged `:<version>` and `:latest`, nothing floating. Pin a version if you would rather choose when to move.

**Downgrading is not supported once a migration has run.** An older image does not know how to undo a newer schema, and there is no down-migration. Take the backup above before an upgrade; that snapshot is the way back.

## Behind a Reverse Proxy

The container serves plain HTTP. Put HTTPS in front of it for anything reachable from the internet: secure cookies and OAuth redirects both need it.

The proxy has to forward the original host and protocol, or Lore builds its links against the proxy's own view and OAuth callbacks land nowhere:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
}
```

## Bind Mounts and File Ownership

The container runs as **uid 1000**, not root.

A **named volume** (`-v lore:/data`) inherits ownership from the image, which is set up for that user, and needs nothing.

A **bind mount** (`-v /srv/lore:/data`) does not: the host directory keeps its own ownership, and the first write fails. Fix it on the host before starting the container:

```bash
sudo mkdir -p /srv/lore
sudo chown 1000:1000 /srv/lore
```

If a bind mount is not a requirement, a named volume is the simpler answer.
