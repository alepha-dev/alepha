# A throwaway server, from a shell

A server bought for an hour, enrolled with Lore, deployed to, tested and
deleted, with every step a command and no web page in the loop. This is the
loop an agent runs to try a change on a real machine.

It was walked on 2026-11-06 on a Scaleway DEV1-S (about €0.009 an hour, Ubuntu
24.04): about ten minutes from buying the server to deleting it.

It needs the Lore CLI and Bay of the release after 0.35.0, which added the
commands below.

## The short way: Lore buys the server

With the Lore CLI of 0.36.1 or later, one command replaces steps 1
and 2 below, and `lore estate delete` replaces the provider's terminate:

```bash
brew install scw && scw login
npm i -g alepha @alepha/lore && lore login

lore estate provision --provider scaleway --project hello-world
alepha init hello-world --infra lore
cd hello-world
alepha deploy
```

`provision` drives your own `scw`, so Lore holds no key to your cloud account.
It names the estate with three random words (or `--name`), creates the project
when it does not exist and lends the estate to it, creates the server with
cloud-init that installs Bay with a one-time enrolment secret and an sslip.io
base domain, and returns once the machine is online, about three minutes
later. `alepha deploy` says which estate it deploys to and ends with the app's
address. When you are done:

```bash
lore project delete hello-world --confirm hello-world   # the app and its copies go, and free the estate
lore estate delete <its-name> --yes                     # terminates the server, its IP and its disk
```

The project goes first: an estate is refused while a copy still deploys to it,
and the refusal says how to remove one. If `hello-world` already exists,
`provision` says so and lends the estate to it, and warns when that project
cannot deploy apps yet; a scratch project of its own is the safer choice for a
throwaway server, since deleting it takes everything in it.

The rest of this page is the long way, with the provider's CLI in your own
hands: what `provision` does for you, one step at a time.

## The long way

You need the [Lore CLI](/lore/docs/guides-cli) signed in (`lore login`), a
provider CLI (here Scaleway's `scw`, set up with an SSH key), `jq`, and a Lore
project to work in:

```bash
lore project create scratch
lore project capability enable apps --option stacks
```

`capability enable` keeps the options already on (Deploy apps) and adds the
ones named.

## 1. Buy the server

```bash
scw instance server create type=DEV1-S image=ubuntu_noble name=scratch tags.0=throwaway -o json | jq -r .id > server-id
scw instance server wait "$(cat server-id)"
IP=$(scw instance server get "$(cat server-id)" -o json | jq -r .public_ip.address)
BASE=${IP//./-}.sslip.io   # 203-0-113-10.sslip.io
```

The server is billed by the hour from here on. Its IP gives it a name with no
DNS to set up: `<anything>.<ip-with-dashes>.sslip.io` resolves to it.

## 2. Enrol it with Lore, in one line

```bash
SECRET=$(lore estate add scratch-vps --allow-deploys --ttl 2h --output json | jq -r .secret)
ssh root@$IP "curl -sSL https://alepha.dev/bay/install.sh | LORE_URL=https://lore.alepha.dev LORE_ESTATE_SECRET=$SECRET BAY_BASE_DOMAIN=$BASE sh"
lore estate wait scratch-vps
```

- `--output json` hands the one-time secret to the script; `--ttl 2h` marks the
  estate overdue in two hours and tells you once, so a forgotten server does
  not go unnoticed. Lore never stops or deletes it.
- With `LORE_URL` and `LORE_ESTATE_SECRET`, the installer installs Docker and
  Bay, writes and starts the systemd unit, waits for `bay serve`, and runs
  `bay connector set`. The secret is never printed.
- `BAY_BASE_DOMAIN` is what apps are named under (`<app>.<base>`); without one,
  Bay refuses to deploy an app.
- `lore estate wait` returns once the machine is online. `lore estate get
  scratch-vps` then shows the public IP Lore saw it connect from.

On the machine, `bay status`, `bay doctor` and `bay connector show` need no
flags: they find the installer's `/opt/bay/data` and `/run/bay/control.sock`.

## 3. Deploy a stack, on HTTPS

```yaml
# compose.yml
services:
  web:
    image: traefik/whoami:v1.10
    x-lore:
      port: 80
```

```bash
lore stack create --file compose.yml --estate scratch-vps
lore stack deploy -e staging --test-hostname web
curl https://staging-scratch.$BASE/
```

`--test-hostname web` routes `<env>-<stack>.<ip>.sslip.io` to the `web` service
before the deploy, and Bay obtains a Let's Encrypt certificate for it on the
first request: on the walk, the first `curl` already answered over a verified
certificate.

## 4. Deploy an app

An app scaffolded for Lore deploys with one command, which ends with where it
answers:

```bash
npm create alepha hello -- --infra lore --lore-project scratch
cd hello
npx alepha deploy
# → https://hello.203-0-113-10.sslip.io
```

`--infra lore` writes `lore({ project })` into `alepha.config.ts` and mounts the
sigil, so the app reports its page views, Web Vitals and errors to the project
from the first deploy. `lore deploy -t latest -e production` redeploys a stored
build the same way.

## 5. Delete everything

```bash
lore stack destroy -e staging --yes
lore stack delete --yes
lore apps instance delete --app hello --env production --yes
lore estate delete scratch-vps --yes
scw instance server terminate "$(cat server-id)" with-ip=true with-block=true
lore project delete scratch --confirm scratch
```

Order matters, and Lore says so: an estate a copy or a stack still deploys to
is refused (naming them), and so is a stack with an environment left.
`estate delete` revokes the machine's secret but stops nothing on it, which is
why the server goes with its provider, with its IP and its disk: a plain
delete leaves both billing. `scw instance server list`, `scw instance ip list`
and `scw block volume list` come back empty afterwards.
