# @alepha/lore - Client

## Installation

```bash
npm install @alepha/lore
```

## Overview

Driving Lore from another Alepha server.

The third half of this package. `@alepha/lore/sigil` is what a running app
reports WITH, `@alepha/lore/cli` is what a pipeline runs, and this is what an
application calls when its environments have a lifecycle of their own: one
deployed copy per tenant, per branch, per customer.

```ts
const alepha = Alepha.create().with(AlephaLoreClient);
const lore = alepha.inject(LoreDeployService);

// A club owner signs up with the slug "wassup":
const { url } = await lore.deploy({
  app: "club",
  env: "wassup",
  tag: "latest",
  domain: "wassup.club.example",
});
```

Configured by the same three variables CI already sets - `LORE_URL`,
`LORE_API_KEY`, `LORE_PROJECT` - so one deployment configures both halves.

## ⚠️ Why this is not `$client<DeployController>`

`$client<T>` puts `T` into this package's exported signatures, and `T` here
would come from the `lore` workspace, which is `private` and never
published. `scripts/check-dts.ts` fails the build on exactly that, so the
failure lands on us rather than on whoever installs the tarball.

`@alepha/lore/cli` uses `$client` freely because a binary's types stay
internal; a library's return types ARE its interface. So this addresses
endpoints by path and declares its own result shapes, the way
`ArtifactUploader` already does. `LoreApiClient` is the one class that knows
a path, so there is one place to look when Lore moves one.

## ⚠️ No filesystem, no `node:` anything

There is no token store here and no device flow: those are for a laptop, and
a server holds an API key. That is what keeps this subpath importable from a
Cloudflare Worker, which is where an app that provisions tenants on demand is
most likely to run.

## ⚠️ It does not build, and it never will

Lore's Worker cannot run Vite, so an artifact is always produced on the
machine holding the source. `lore apps build` and `lore artifacts push`
belong in CI; this ships bytes that already exist and refuses when the tag
names none.
