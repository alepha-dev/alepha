# Installing Bay on a host

Bay is a single static Go binary plus a data directory. Installing it is four steps; **granting a
human or a CI job the right to deploy is a fifth, and it is the one people miss.** Three separate
failures on a first real deploy all came from that fifth step, so it has its own section below.

This guide describes a Linux host reached over SSH, which is the only remote surface Bay has:
`alepha platform` drives your own `ssh` binary and talks to Bay's control socket on the other side.
There is no admin panel and no inbound control port.

## 1. Build the binary

Bay is `CGO_ENABLED=0`, so it cross-compiles to a static binary from any machine — including a Mac,
for a Linux host:

```bash
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o bay ./cmd/bay
```

Check the host's architecture first (`uname -m`): `x86_64` is `GOARCH=amd64`, `aarch64` is
`GOARCH=arm64`. A binary built for the wrong one fails with `cannot execute binary file`.

## 2. Put it on the host

```bash
scp bay root@HOST:/opt/bay/bin/bay
```

The layout the rest of this guide assumes:

| Path | What it is |
|---|---|
| `/opt/bay/bin/bay` | the binary |
| `/opt/bay/data` | `--root`: app releases, state, per-app `.env`, SQLite files |
| `/opt/bay/runtimes` | `--runtimes`: the Node runtimes apps are launched with |
| `/run/bay/control.sock` | the control socket, created at startup |

`/opt/bay/data` is the only directory that must survive an upgrade. It holds every app's releases
and durable state.

## 3. Run it under systemd

```ini
# /etc/systemd/system/bay.service
[Unit]
Description=Bay — Alepha application server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
# Bay IS the reverse proxy: if it dies, every hosted app goes dark. Always come
# back, and come back fast.
Restart=always
RestartSec=2
WorkingDirectory=/opt/bay
RuntimeDirectory=bay
RuntimeDirectoryMode=0755
ExecStart=/opt/bay/bin/bay serve \
  --root /opt/bay/data \
  --runtimes /opt/bay/runtimes \
  --base-domain bay.example.com \
  --addr :80 \
  --tls --tls-addr :443 \
  --acme-email you@example.com \
  --control-socket /run/bay/control.sock

[Install]
WantedBy=multi-user.target
```

`RuntimeDirectory=bay` is what creates `/run/bay` on start and removes it on stop; without it the
`--control-socket` path has no parent directory. Ports 80 and 443 both matter even if you only serve
HTTPS — ACME's HTTP-01 challenge answers on 80.

```bash
systemctl daemon-reload && systemctl enable --now bay
```

## 4. Check it came up

```bash
bay status --control-socket /run/bay/control.sock
```

As root that should print the hosted apps (none yet, on a fresh install).

## 5. Grant a user the right to deploy — the step that bites

Everything above leaves a Bay that only **root** can drive. A deploy over SSH runs as an ordinary
user, and it needs two things root never did. Both failures are silent about their real cause until
you know to look.

### 5a. The `bay-control` group exists, and starts empty

At startup Bay creates a system group (`bay-control` by default, `--control-group` to change it),
chowns the socket to it and sets mode `0660` — so the socket is `root:bay-control`, and **nobody but
root can reach it until you add someone**. Bay creates the group; adding members is yours.

```bash
sudo usermod -aG bay-control ubuntu
```

Group membership is read at login, so an **existing SSH session keeps the old groups**. Open a new
one. If your `~/.ssh/config` uses `ControlMaster`/`ControlPersist`, the multiplexed connection is
reused too and hides the change — close it with `ssh -O exit HOST` first.

Without this, the symptom is:

```
error: control api unreachable (is `bay serve` running?):
  dial unix /run/bay/control.sock: connect: permission denied
```

Note the message blames `bay serve` for being down. It is running; you simply cannot reach it.

### 5b. `bay` must be on the *non-interactive* PATH

`alepha platform` runs its commands as `ssh HOST bay ...`, which starts a **non-interactive** shell.
That shell reads neither `~/.profile` nor `~/.bashrc`'s interactive section, so a PATH exported there
does not apply. Put the binary somewhere already on the default PATH:

```bash
sudo ln -s /opt/bay/bin/bay /usr/local/bin/bay
```

Without this:

```
Signed in to HOST, but `bay` is not on that user's PATH.
  (bash: line 1: bay: command not found)
```

### 5c. Verify both at once

```bash
ssh HOST 'groups; command -v bay; bay status --control-socket /run/bay/control.sock'
```

You want `bay-control` in the groups, a path for `bay`, and real app output — not a permission error.

## 6. Point a project at it

In the deploying project's `alepha.config.ts`:

```typescript
platform({
  environments: {
    production: {
      adapter: "bay",
      host: "bay-prod",
      socket: "/run/bay/control.sock",
    },
  },
});
```

`host` is an SSH destination handed verbatim to your `ssh`, so a `~/.ssh/config` alias is the best
value — it carries the port, identity file and any jump host, none of which this config has fields
for. `$BAY_HOST` overrides it.

**Do not point `host` at the app's public domain if that domain sits behind a CDN.** A proxied
record resolves to the CDN's addresses, which serve HTTP and not SSH, and the connection simply
fails. Use the machine's own name, its address, or an alias.

`socket` is required whenever `--root` is not `./bay-data` under the deploying user's home. The
adapter's default guess is `<root>/control.sock` resolved from `$HOME` — an SSH command's shell
starts there — so every `--root /opt/bay/data` install needs the path spelled out. It must be
absolute.

Then, from the project:

```bash
alepha platform status -e production
```

## 7. Upgrading Bay

Replace the binary and restart. `/opt/bay/data` is untouched, and hosted apps keep running until the
restart cycles them.

```bash
sudo install -m 0755 bay /opt/bay/bin/bay && sudo systemctl restart bay
```

**Keep the host's Bay at least as new as the `alepha` CLI deploying to it.** The CLI streams the
deploy artifact to `bay deploy -`, reading it from stdin; a Bay predating that support tries to open
a file literally named `-`:

```
Signed in to HOST, but its `bay` is too old to read the deploy artifact from stdin —
  it tried to open a file literally named "-". Upgrade `bay` on the host.
  (error: open -: no such file or directory)
```

A Bay predating `bay env` is the second version gate, and the one that costs a running app its
configuration. `alepha platform up` pushes the app's declared secrets to `bay env set <name/env> -`;
a Bay that has no such command prints its whole usage banner and exits 2, which the CLI reports as:

```
Signed in to HOST, but its `bay` has no `env` command, so there is nowhere to put this
  app's secrets — it answered with its usage banner instead. Upgrade `bay` on the host.
```

The deploy fails at the secrets step, after the code has already landed: the app is serving the new
release **without** the secrets. Upgrade the binary and re-run `alepha platform up`.

A project with nothing to push never reaches this and keeps deploying to an old Bay unchanged — an
app that declares no `$env` keys, or whose declared keys are set neither in `.env.<env>` nor in the
deploying environment. Static sites are skipped outright, having no process to configure.

`bay --version` prints `dev` for a plain `go build`, so it will not tell you how old an installed
binary is. Its mtime (`ls -l /opt/bay/bin/bay`) is the practical answer.

## Setting an app's environment by hand

The same door the deploy uses. Values are read from stdin — never from the command line, where an
argument is visible in `ps` to every user on the machine and is kept in the shell's history:

```bash
bay env set myapp/production -   <<'ENV'
STRIPE_KEY=sk_live_…
MAILER_DSN=smtp://…
ENV

bay env list myapp/production    # which variables are set, by NAME only
```

Keys Bay writes itself (`APP_SECRET`, `DATABASE_URL`, `SERVER_PORT`, `APP_NAME`, `DATA_DIR`,
`STORAGE_PATH`, `S3_*`) are **refused**, naming the key. `APP_SECRET` is the reason: it is generated
once per instance and never regenerated, because a new value signs every user out and the one it
replaced is gone.

Anything whose value actually changes restarts the app — an environment variable the running process
never sees has not been set. An identical push writes nothing and restarts nothing.

## Diagnosing a failed deploy

The `alepha platform` pre-flight distinguishes these for you, so read its message before digging:

| Message | Fix |
|---|---|
| `bay` is not on that user's PATH | §5b — symlink into `/usr/local/bin` |
| `connect: permission denied` on the socket | §5a — add the user to `bay-control`, then reconnect |
| too old to read the artifact from stdin | §7 — upgrade the host binary |
| `bay` has no `env` command | §7 — upgrade the host binary; the code landed, the secrets did not |
| `control api unreachable` as root | Bay really is down: `systemctl status bay` |
