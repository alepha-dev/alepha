# Your first app on a VPS

From nothing to an Alepha app served over HTTPS from a server you rent, in seven
steps. Each step is short and links to the guide that covers it in full.

You need:

- a Linux server with a public IP, on `amd64` or `arm64` (any VPS with Ubuntu
  24.04 works), with ports 80 and 443 open;
- root access to it over SSH, with your key;
- Node.js on your machine.

Commands marked **local** run on your machine; **server** commands run as root
on the server.

## 1. Create the app

**Local:**

```bash
npm create alepha myapp
cd myapp
npm run dev
```

The app's name, `myapp`, comes from `package.json` and names everything Bay
creates for it.

## 2. Pick a domain

Bay serves an app under a **base domain**: `myapp.<base-domain>` for
production, `myapp-staging.<base-domain>` for any other environment. Point a
wildcard DNS record at the server:

```txt
*.apps.example.com.  A  203.0.113.10
```

For a quick test with no DNS of your own, a wildcard DNS service that maps an IP
to a name works too: `203.0.113.10.sslip.io` resolves every subdomain to
`203.0.113.10`.

## 3. Install Bay

**Server:**

```bash
curl -sSL https://alepha.dev/bay/install.sh | sudo sh
sudo bay doctor
```

The installer sets up Docker when it is missing and installs the binary, and
stops there: running Bay as a service is the next step.
[Installation](/bay/docs/guides-installation) lists what it lays out and the
variables it takes.

## 4. Run Bay as a service

**Server:** write `/etc/systemd/system/bay.service`, with your base domain:

```ini
[Unit]
Description=Bay - Alepha application server
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
Restart=always
RestartSec=2
WorkingDirectory=/opt/bay
RuntimeDirectory=bay
RuntimeDirectoryMode=0755
ExecStart=/opt/bay/bin/bay serve \
  --root /opt/bay/data \
  --base-domain apps.example.com \
  --addr :80 \
  --tls --tls-addr :443 \
  --control-socket /run/bay/control.sock

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now bay
bay status --control-socket /run/bay/control.sock
```

A fresh Bay hosts no app yet (`no apps deployed`). Certificates come from Let's
Encrypt on the first request to each domain; add `--acme-email you@example.com`
to give the certificate authority a contact address. The unit's options are
explained in [Installation](/bay/docs/guides-installation#2-run-it-under-systemd).

## 5. Give a user the right to deploy

Deploys run over SSH as an ordinary user in the `bay-control` group, which Bay
creates when it starts. Membership of that group **is** the permission: there
is no token.

**Server:**

```bash
useradd -m -s /bin/bash -G bay-control deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
install -m 600 -o deploy -g deploy ~/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
```

This lets every key that opens root's account open `deploy`'s too; copy only
your own key if root accepts others.

**Local:**

```bash
ssh deploy@203.0.113.10 'groups; bay status --control-socket /run/bay/control.sock'
```

You want `bay-control` among the groups and no permission error.

## 6. Deploy

**Local:** in `alepha.config.ts`:

```typescript
import { defineConfig } from "alepha/cli/config";
import { bay, infra } from "alepha/cli/infra";

export default defineConfig({
  plugins: [
    infra({
      environments: {
        production: bay({
          host: "deploy@203.0.113.10",
          socket: "/run/bay/control.sock",
        }),
      },
    }),
  ],
});
```

```bash
npx alepha infra login --env production
npx alepha deploy --env production
```

`infra login` checks the key, the group and Bay itself, and changes nothing.
`deploy` builds the app for Node, packs it with its migrations, and streams it
over SSH to Bay, which starts the release, waits for `/health`, then switches
traffic to it. The deploy prints the address, and the app answers there:

```bash
curl https://myapp.apps.example.com/version
```

`/version` reports the app's name, version, build date and runtime.

Secrets come from `.env.production` and `.env.production.local`, limited to the
keys the app declares; migrations run when the app starts. Both are covered in
[Bay Deployment](/docs/guides-deployment-bay#secrets).

## 7. Watch it, then take it down

**Local:**

```bash
npx alepha infra status --env production
ssh deploy@203.0.113.10 'bay logs myapp/production -n 200 --control-socket /run/bay/control.sock'
```

To go back to an earlier release, deploy it again: Bay rolls back by itself only
when a new release never becomes healthy. [Operating](/bay/docs/guides-operating)
covers logs, restarts and upgrades.

When you are done:

```bash
npx alepha infra down --env production
```

It asks for confirmation; `--yes` skips the question in a script. The app is
removed from Bay, while its database and uploads stay on the server. Then delete
the server with your provider, which is what stops the bill.

## Next

- [Deploy through Lore](/bay/docs/tutorials-deploy-through-lore): the same
  server, driven from Lore, with telemetry.
- [Backups](/bay/docs/guides-backups) before the app holds data you care about.
- [Stacks](/bay/docs/guides-stacks) to run a database or a queue beside the app.
