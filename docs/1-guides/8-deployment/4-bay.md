# Bay Deployment

[Bay](https://github.com/alepha-dev/bay) is a self-hosted application server for Alepha apps. Where
Cloudflare gives you someone else's serverless infra, Bay runs your apps as ordinary long-lived
processes on a machine you own, with TLS, rollback and process isolation handled for you.

This page covers the framework's side: the `bay()` adapter used by `alepha deploy` and `alepha infra`, which deploys an app
to a host that already runs Bay. Bay itself (installing it, running it, upgrading it, its own CLI) is
documented in [its repository](https://github.com/alepha-dev/bay). The short version of installing
it, on the host:

```bash
curl -sSL https://raw.githubusercontent.com/alepha-dev/bay/main/install.sh | sudo sh
```

Use Bay when you want a long-lived runtime (background work between requests, in-process caches, a
local SQLite file), when you would rather pay for one VPS than per-request, or when the data has to
stay on hardware you control.

## Build

```bash
alepha build --runtime=node
```

Bay reads the build manifest, so it needs no Wrangler configuration. The adapter builds a Node slice by default, or preserves `runtime: ["static"]` for a site. `alepha deploy` builds this artifact during the full lifecycle. A workerd-only artifact cannot run on Bay and is refused before upload.

`alepha infra deploy` authenticates and deploys a prebuilt Node or static artifact. It skips the separate local provision/build/migrate/secrets steps, while Bay's host still provisions from the uploaded manifest and Alepha still applies migrations on startup. See [Static Deployment](/docs/guides-deployment-static) for sites without a server process.

## Configuration

```typescript
infra({
  environments: {
    production: bay({
      host: "deploy@bay.example.com",
      domain: "myapp.com",
    }),
  },
});
```

`host` is the SSH destination of the machine, and it is **required** - unlike Cloudflare there is no
global endpoint to fall back on, because a Bay is a machine someone owns. Set it in the config or
export `BAY_HOST`.

It is handed to your own `ssh` binary verbatim, so it can be an alias from `~/.ssh/config`:

```txt
Host bay-prod
  HostName 203.0.113.10
  User deploy
  IdentityFile ~/.ssh/bay
  ProxyJump bastion.example.com
```

```typescript
bay({ host: "bay-prod" });
```

That is deliberate. There is no port, identity-file, jump-host or ssh-flags field here, because
`~/.ssh/config` already has all of them and having two places to configure one connection is worse
than having one. It also means `host` rejects a bare IPv6 literal (`2001:db8::1`) and an `ssh://` URI
outright - the pattern that keeps this value off a command line safely accepts a hostname, an IPv4
address, or `user@host`, but not a colon. Reach an IPv6-only host through a `~/.ssh/config` alias
instead, the same as any other connection detail this field does not carry directly.

If the Bay was started with a `--root` other than its default (`./bay-data`, resolved under the
deploy user's home), also set `socket` - an **absolute** path; the validation pattern requires a
leading `/`, since the value is passed straight through as `--control-socket <path>` with no
resolution against a working directory:

```typescript
bay({ host: "deploy@bay.example.com", socket: "/run/bay/control.sock" });
```

Bay's own guess at its control socket is `<root>/control.sock`, but every command this adapter sends
runs as a non-interactive `ssh` command, whose shell starts in `$HOME` - so that guess only lands when
the root really is `./bay-data` under the deploy user's home, and misses for any other root. Bay's
`$BAY_SOCKET` environment variable is its own escape hatch for this, but it cannot be relied on here:
a non-interactive shell reads neither `~/.profile` nor, on stock Debian/Ubuntu, `~/.bashrc`. Setting
`socket` (or exporting `BAY_SOCKET` in the CLI's own environment, which overrides the config the same
way `BAY_HOST` overrides `host`) sidesteps needing a remote shell profile at all - it is appended as
`--control-socket <path>` to every `bay` command this adapter runs. Leave it unset only when the Bay
genuinely runs with its default root under the deploy user's home, which a production install
usually does not.

## Prerequisites on the host

Bay itself, installed and running (see above), and two things outside Alepha:

1. **Your public key is in `~/.ssh/authorized_keys`** for the user you connect as. Alepha never
   handles the key - it runs `ssh`, and `ssh` does what it always does.
2. **That user is in the `bay-control` group.** Bay publishes its control socket at mode `0660` owned
   by that group, so membership _is_ the deploy permission - there is no token to issue, store or
   revoke.

```bash
sudo usermod -aG bay-control deploy   # on the host; the user must then reopen their session
```

Check both in one command:

```bash
alepha infra login --env production
```

It confirms the key, the group, and Bay's control socket itself: after checking that the user is in
`bay-control`, it makes a real `bay list` call over the socket, rather than the version check alone
that would prove no more than "ssh works and `bay` is on PATH". Those failures look nothing alike and
only one of them is about SSH, so it is worth running once before the first deploy - the group problem
otherwise surfaces halfway through as a permission error mentioning neither Bay nor the group.

If that command (or `bay list`, behind `alepha infra status`) fails with a raw detail saying "no
control socket found" rather than a plain permission error naming a `.sock` path, the group is not the
problem - it means Bay never even tried to dial anything, because its own guess at the socket path
missed entirely. Set `socket`, above, to the actual path. A permission error that _does_ name a `.sock`
path is the genuine group problem instead: Bay found the socket file but refused to dial it for that
user.

`alepha infra logout --env production` exists but always refuses: nothing was stored, so there is nothing to
forget, and refusing loudly is safer than doing nothing quietly, which would look like access had been
revoked. Revoke access for real by removing the key from `authorized_keys`, or drop the user from
`bay-control` to stop deploys without closing the account.

## Deploy

```bash
alepha deploy --env production
```

Under the hood: `alepha build --runtime=node`, then `alepha pack` - which produces
`<project>-latest.tar.zst` containing the bundle and its `migrations/` directory - then one `ssh`
invocation that pipes the artifact straight into the Bay's own CLI:

```bash
ssh -o BatchMode=yes deploy@bay.example.com \
  'bay deploy - --name myapp --env production --domain myapp.com' < myapp-latest.tar.zst
```

Nothing is staged on the host first, so a deploy that dies mid-way leaves no half-uploaded artifact
behind. `BatchMode=yes` is always set: in CI a passphrase prompt would hang forever, and a hung prompt
is indistinguishable from a hung deploy.

Bay takes it from there: it reads the manifest, creates what the app declares, starts the new release,
waits for `/health` to answer, swaps traffic over, and keeps the previous release around to roll back
to if readiness never arrives.

## Secrets

`alepha deploy` pushes them, and **which keys** it pushes is decided by what your app declares
via `$env` - captured into `dist/manifest.json` at build time. That list is the allowlist. Each
value then resolves from `.env.<env>` (and `.env.<env>.local`) first, and from `process.env` second.

That second step is what makes CI work: a runner checks out, builds, and holds the secrets in the job
environment with no `.env` file on disk anywhere. It is also the step that has to be bounded, because
the machine running a deploy has other people's credentials in its environment - `GITHUB_TOKEN`,
`AWS_SECRET_ACCESS_KEY`, another project's Cloudflare key. The bound is that **the key set never
comes from `process.env`**: an undeclared variable is never looked up, so it can never travel. With
no manifest and no `.env.<env>` file there is no allowlist at all, and nothing is pushed.

`infra({ secrets: { keys: [...] } })` in `alepha.config.ts` overrides the allowlist outright - to
narrow it, or to add a key the app reads through `process.env` rather than `$env`.

**They travel with the deploy, not after it.** The values are staged to a 0600 file on the host and
that file's path is handed to `bay deploy`:

```bash
ssh -o BatchMode=yes deploy@bay.example.com 'umask 077; cat > /tmp/.bay-secrets-<random>' \
  < the-filtered-assignments
ssh -o BatchMode=yes deploy@bay.example.com \
  'bay deploy - --name myapp --secrets-file /tmp/.bay-secrets-<random>' < myapp-latest.tar.zst
```

Bay merges that file into the instance's `.env` before the release is swapped in and before the
process starts, so the app boots with its secrets, and a host that rejects them rejects the whole
deploy with the previous release still serving.

The file never holds a value on a command line - an argument sits in the host's process table for any
user running `ps`, and in the local shell's history. `umask 077` before the redirect rather than a
`chmod` after it, so the file is 0600 from the instant it exists; the name is 16 random bytes, so a
predictable path cannot be pre-created by another user as a symlink. Bay consumes the file whether
the deploy succeeds or is refused, so an aborted deploy strands no plaintext credentials on the host.

Two classes of key are dropped even when the app declares them, each with a line in the deploy log
saying so:

- **Keys Bay writes itself**: `APP_SECRET`, `DATABASE_URL`, `SERVER_HOST`, `SERVER_PORT`, `APP_NAME`, `DATA_DIR`,
  `STORAGE_PATH` and the `S3_*` family. Bay refuses these on its own side too, naming the key.
- **Framework infra knobs**: `LOG_LEVEL`, `DEBUG`, `NODE_ENV` and friends, which have defaults and
  are the platform's business rather than the app's.

`alepha infra status` reports the names that are actually set on the host, asked of it with
`bay env list` - names only; Bay never answers with a value.

If there is nothing to send, the deploy says so rather than finishing quietly. A **static site** is
skipped entirely and says so too: it has no process, so it has no environment, and anything it needs
at build time is already inside the artifact.

To change a running app's configuration **without** redeploying it, use Bay's own `bay env set` on
the host; see [Bay's documentation](https://github.com/alepha-dev/bay).

> This needs a `bay` on the host new enough to know `--secrets-file`. An older one refuses the flag,
> and the CLI turns that into `its bay does not know --secrets-file … Upgrade bay on the host`. That
> failure happens **before anything is unpacked**, so the release that was serving still is.

## Resources

You do not provision anything from the CLI. Cloudflare needs `provision` because D1, R2 and KV are
account-level resources created through an API; Bay creates what the manifest asks for on the machine
itself, at deploy time.

The practical consequence: `alepha infra status` reports the running app and its release, and
reports **empty** database and storage lists. That is deliberate honesty rather than a gap - Bay
exposes no inventory of what it created, and listing what the manifest _asked for_ would report
intent as fact.

## Migrations

The adapter's separate migrate step is a no-op, including `alepha infra db migrate --env production` on Bay.

Migrations are the app's own business here: Alepha runs them during its own boot as soon as a
`migrations/` directory sits next to the bundle, and `alepha pack` always includes one. Redeploying
the app _is_ migrating it.

## Status and teardown

```bash
alepha infra status --env production
alepha infra down --env production
```

`down` unregisters the app and stops serving it. The database and the uploads are **kept**, in the
app's own directory on the host - on Bay they live inside the instance rather than in a managed
service, so a teardown that deleted them would have no way back. Destroying them is a separate,
deliberate act on the host itself, with Bay's own CLI.

## Bay versus Cloudflare

|                | Bay                                                     | Cloudflare                                 |
| -------------- | ------------------------------------------------------- | ------------------------------------------ |
| Runtime        | long-lived Node/Bun process                             | `workerd` isolate, per request             |
| Build artifact | Node (or static)                                        | `workerd` slice                            |
| Provisioning   | by Bay, from the manifest, at deploy                    | by the CLI, via the Cloudflare API         |
| Database       | SQLite file (or your own Postgres) in the app directory | D1, or Postgres via Hyperdrive             |
| Migrations     | at app boot                                             | `alepha infra db migrate`                  |
| Access         | SSH key + `bay-control` group membership                | `CLOUDFLARE_API_TOKEN` or `wrangler login` |
| Rollback       | automatic on failed readiness                           | redeploy the previous version              |
| Scaling        | one machine                                             | Cloudflare's edge                          |

Both provision from your `$repository` / `$storage` / `$cache` / `$job` declarations - you do not
maintain infrastructure config by hand on either.

## Full example

```typescript
// alepha.config.ts
import { defineConfig } from "alepha/cli/config";
import { bay, infra } from "alepha/cli/infra";

export default defineConfig({
  plugins: [
    infra({
      environments: {
        production: bay({
          host: "deploy@bay.example.com",
          domain: "myapp.com",
        }),
        staging: bay({
          host: "deploy@bay.example.com",
        }),
      },
    }),
  ],
});
```

```bash
alepha infra login --env production   # checks the key and the group, changes nothing
alepha infra plan --env production         # shows what will happen, touches nothing
alepha deploy --env production
```
