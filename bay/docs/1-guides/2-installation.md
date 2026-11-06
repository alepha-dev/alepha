# Installation

Install Bay on a Linux host in five steps: the binary, a systemd unit, a check,
and the step people miss, granting a human or a CI job the right to deploy.

Bay is a single static binary plus a data directory. The only remote surface it
has is SSH: `alepha deploy` drives your own `ssh` binary and talks to Bay's
control socket on the other side. There is no admin panel and no inbound
control port.

## Requirements

- Linux on `amd64` or `arm64`.
- **Docker Engine 25 or newer** with the **compose plugin**, on **cgroup v2**:
  Bay runs every app in a container. The installer sets Docker up when it is
  missing.
- Ports **80** and **443** free. Port 80 answers the ACME HTTP-01 challenge even
  if you only serve HTTPS.
- A DNS record pointing each app's domain (or a wildcard under a base domain)
  at the machine.

## 1. Install the binary

```bash
curl -sSL https://alepha.dev/bay/install.sh | sudo sh
```

The script installs Docker through get.docker.com when it is missing, fetches
the newest release for the host's architecture from the
[GitHub releases](https://github.com/alepha-dev/alepha/releases), verifies it
against `SHA256SUMS`, and lays out:

| Path                    | What it is                                                                      |
| ----------------------- | ------------------------------------------------------------------------------- |
| `/opt/bay/bin/bay`      | the binary                                                                      |
| `/usr/local/bin/bay`    | a symlink, so `bay` is on the PATH of a non-interactive SSH shell               |
| `/opt/bay/data`         | the data root (`--root`): releases, state, each app's `.env` and SQLite files   |
| `/run/bay/control.sock` | the control socket, created by `bay serve` at startup (with the unit of step 2) |

It stops there on purpose: the systemd unit, the base domain, the ACME email
and the deploy group need decisions a `curl | sh` cannot make for you.

| Variable             | Default              | Effect                                       |
| -------------------- | -------------------- | -------------------------------------------- |
| `BAY_VERSION`        | `latest`             | a version such as `1.0.0`, or `latest`       |
| `BAY_PREFIX`         | `/opt/bay`           | install root                                 |
| `BAY_BIN_LINK`       | `/usr/local/bin/bay` | symlink put on the PATH                      |
| `BAY_INSTALL_DOCKER` | `yes`                | `no` stops instead of installing Docker      |

Re-running the script upgrades in place: the binary is replaced atomically and
a running `bay` service is restarted.

Check the host before the first start, as root:

```bash
sudo bay doctor
```

It prints one line per check (Docker reachable and recent, cgroup v2, compose,
ports 80 and 443, free disk under `--root`, `/opt/bay/data` by default) and
exits with status 1 when one fails. Once Bay runs it holds ports 80 and 443,
and the doctor accepts that only when a Bay answers on the socket it finds
(`/run/bay/control.sock` for this unit), so on a live host:

```bash
sudo bay doctor
```

### Building it yourself

Bay is `CGO_ENABLED=0`, so it cross-compiles from any machine, a Mac included.
From the `bay/` folder of the repository:

```bash
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o bay ./cmd/bay
scp bay root@HOST:/opt/bay/bin/bay
```

`uname -m` on the host tells you the architecture: `x86_64` is `amd64`,
`aarch64` is `arm64`.

## 2. Run it under systemd

```ini
# /etc/systemd/system/bay.service
[Unit]
Description=Bay - Alepha application server
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
# Bay is the reverse proxy: if it dies, every hosted app goes dark.
Restart=always
RestartSec=2
WorkingDirectory=/opt/bay
RuntimeDirectory=bay
RuntimeDirectoryMode=0755
ExecStart=/opt/bay/bin/bay serve \
  --root /opt/bay/data \
  --base-domain bay.example.com \
  --addr :80 \
  --tls --tls-addr :443 \
  --acme-email you@example.com \
  --control-socket /run/bay/control.sock

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now bay
```

- `RuntimeDirectory=bay` has systemd create `/run/bay` on start and remove it on
  stop. Bay creates the directory itself when it is missing.
- `--base-domain` is what an app without a domain of its own is served under:
  `myapp.bay.example.com`, or `myapp-staging.bay.example.com` for a
  non-production environment.
- `--addr` and `--tls-addr` default to `:8080` and `:8443`, which suits a test
  install. A public host sets them to `:80` and `:443`.

⚠️ **Do not add `PrivateTmp=yes`.** A deploy carrying secrets stages them in
`/tmp` as the deploying user, and Bay reads them as root: a private `/tmp`
makes those two different directories, and every such deploy fails with
`no secrets file at /tmp/...`.

⚠️ **Behind a Cloudflare proxy, use SSL mode Full (strict), never Flexible.**
Flexible talks plain HTTP to the origin, Bay redirects it to HTTPS, and the
browser reports "too many redirects" with nothing in Bay's logs to say why.

## 3. Check it came up

```bash
sudo bay status
```

As root, it prints the hosted apps: none yet on a fresh install.

`bay` looks for the socket at `./bay-data/control.sock`, then at
`/run/bay/control.sock`, where this unit puts it, so a client command on this
host needs no flag. The guides that follow still show the export, which a unit
with other paths needs and this one does no harm with:

```bash
export BAY_SOCKET=/run/bay/control.sock
```

## 4. Grant a user the right to deploy

Everything above leaves a Bay that only **root** can drive. A deploy over SSH
runs as an ordinary user, who needs two things root never did.

### Membership of `bay-control`

Bay creates a system group (`bay-control`, or `--control-group`) and gives the
socket mode `0660` in that group. Membership **is** the deploy permission:
there is no token to issue, store or revoke. Bay creates the group; adding
members is up to you.

```bash
sudo usermod -aG bay-control deploy
```

Group membership is read at login, so an **existing SSH session keeps its old
groups**: open a new one. With `ControlMaster`/`ControlPersist` in your
`~/.ssh/config`, close the shared connection first with `ssh -O exit HOST`.

Without it, the error blames the wrong thing:

```
error: control api unreachable (is `bay serve` running?):
  dial unix /run/bay/control.sock: connect: permission denied
```

### `bay` on the non-interactive PATH

`alepha deploy` runs `ssh HOST bay ...`, a **non-interactive** shell that reads
neither `~/.profile` nor the interactive part of `~/.bashrc`. The installer's
`/usr/local/bin/bay` symlink covers it; a hand install needs it too:

```bash
sudo ln -s /opt/bay/bin/bay /usr/local/bin/bay
```

### Verify both at once

```bash
ssh deploy@HOST 'groups; command -v bay; bay status'
```

You want `bay-control` among the groups, a path for `bay`, and app output rather
than a permission error. From the project, `alepha infra login --env production`
checks the same things and changes nothing.

## 5. Point a project at it

```typescript
// alepha.config.ts
import { defineConfig } from "alepha/cli/config";
import { bay, infra } from "alepha/cli/infra";

export default defineConfig({
  plugins: [
    infra({
      environments: {
        production: bay({
          host: "bay-prod",
          socket: "/run/bay/control.sock",
          domain: "myapp.com",
        }),
      },
    }),
  ],
});
```

```bash
alepha deploy --env production
```

- `host` is handed to `ssh` verbatim, so an alias from `~/.ssh/config` is the
  best value: it carries the port, identity file and jump host. `BAY_HOST`
  overrides it.
- `socket` is required whenever the root is not `./bay-data` under the
  deploying user's home, which is every install following this page.
- Never point `host` at a domain proxied by a CDN: the CDN answers HTTP, not
  SSH.

The adapter's own options are documented in
[Bay Deployment](/docs/guides-deployment-bay).

## Upgrading Bay

Run the installer again, or replace the binary and restart:

```bash
sudo install -m 0755 bay /opt/bay/bin/bay && sudo systemctl restart bay
```

`/opt/bay/data` is the only directory that must survive an upgrade, and it is
untouched. Hosted apps keep running until the restart cycles them; an app that
was stopped on purpose stays stopped.

**Keep the host's Bay at least as new as the `alepha` CLI deploying to it.**
The CLI names the version gate it hit (`bay` too old to read the artifact from
stdin, or not knowing `--secrets-file`), and in both cases nothing was
deployed: the release that was serving still is.

`bay --version` prints `dev` for a binary you built yourself, so the file's
date (`ls -l /opt/bay/bin/bay`) is the practical answer there.
