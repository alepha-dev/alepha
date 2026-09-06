# @alepha/lore - Cli

## Installation

```bash
npm install @alepha/lore
```

## Overview

What the `lore` binary is made of.

The other half of this package reports from a running app; this half is what
a pipeline runs. It lives here rather than in `alepha/cli` because Lore is a
superset of Alepha and no Lore code belongs inside the framework, and it is
a subpath rather than a package of its own so that both halves share one
answer to "where is Lore, and how do I authenticate to it".

```bash
npm i -g "@alepha/lore"
lore login
lore quality push -p alepha
```

## ⚠️ Six top-level commands, and no root of its own

`quality`, `artifacts`, `attachments`, `releases`, `login` and `logout`
register at the top level, because the binary IS the root. A `lore` command
inside a `lore` binary reads `lore lore quality push`.

That also means nothing here may inject a command from `alepha/cli`:
`Alepha.inject` registers the module that declares a service, so one such
injection would hand this container every Alepha CLI command under a second
name. `commandSurface.spec.ts` is what keeps that true.

The project comes from `-p`, and the secret from `LORE_API_KEY`. No
credential ever lands in a committed file.

## Why `AlephaServerLinksClient` and not `AlephaServer`

`$client` resolves an action against a registry, and in a CLI that registry
has to be fetched from the remote. `AlephaServerLinksClient` carries the
primitive and the provider that fetches it, and nothing that serves:
registering `AlephaServer` here would give a command-line tool an HTTP
listener that binds a port.

⚠️ This subpath carries no `browser` export condition, on purpose. A bundler
that resolves it has wandered somewhere it does not belong, and should fail
on the first `node:` import rather than be handed a stub.
