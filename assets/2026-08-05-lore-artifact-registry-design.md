# Lore as artifact registry — deploy topology, versioning, retention

**Date:** 2026-08-05
**Scope:** v1 = Lore → Bay via `adapter: "lore"`. Cloudflare untouched.
**Status:** design approved, not yet implemented.

## Why

Three questions were open: who deploys, who stores versions, who keeps secrets.
Reading the code answered the first and reframed the second. This spec settles
deploy topology, the version model, and retention. **Secrets are a separate
project** and are deliberately out of scope here.

## What the code already decided

Before designing anything, four findings that removed options from the table:

1. **Bay has no inbound control surface.** The only TCP listeners in
   `cmd/bay/main.go` are the proxy. Control is a unix socket, and `main.go:201`
   states every command except `serve` is a thin client of it. Remote access
   "moved to the connector, which asks Lore for work" — `internal/connector`
   polls outward.

2. **`BayAdapter` is dead.** It speaks OAuth (`/oauth/device_authorization`,
   `/oauth/token`) to an endpoint that was **bay-admin**, which is deleted.
   `example-bay-app` still points at `https://admin.bay.alepha.dev`. It is
   orphaned code targeting a removed service — it goes in the eradication chore,
   not this design.

3. **Bay is already a release registry, and it must be.** `internal/deploy/prune.go`
   keeps `defaultKeepReleases = 5` because *"the proxy serves static files from
   EVERY retained release, so a client holding the previous page's HTML can still
   fetch its hashed chunks after a deploy"*. Releases are stored **unpacked**.
   They are live serving state, not an archive, and cannot move to Lore.
   `rollbackTo` and `watchAndRollback` (auto-rollback on health failure) already
   exist, as does `POST /apps/{name}/{env}/rollback` on the control mux.

4. **Three incompatible notions of "version" coexist.** `alepha pack --tag` is
   Docker-style (`hello-latest.tar.gz`, `hello-1.2.3.tar.gz`);
   `LoreAdapter.version()` throws that away and generates a UTC timestamp to
   match Bay's on-disk directory names. With timestamps only, every release is
   unique, so "keep the latest of each app+tag" degenerates into "keep
   everything". This is the root of "the concept of Version is not clear".

## Decisions

### Topology

`platform → lore → bay`, pull model. The CLI uploads to Lore and never contacts
the machine; Bay's connector claims work on its own outbound channel. This is
already built on both sides — the design ratifies it rather than introducing it.

`ssh + scp + bay deploy` remains the permanent path for deploying Lore itself.

### Two registries, different jobs

| | Bay | Lore |
|---|---|---|
| Form | unpacked release dirs | the `alepha pack` tar.gz |
| Purpose | serving static chunks + instant rollback | archive, re-seed a machine |
| Retention | `--keep-releases`, default 5 | per `(app, tag)` — see below |
| Can it move? | **No** — it serves traffic | Yes |

**Rollback is a command, not a transfer.** Lore sends `rollback` down the
existing command channel (`outpostCommands.ts` was written anticipating it:
*"a second one — restart, rollback — is an added key"*) naming a release Bay
already retains. Lore never re-uploads bytes to roll back.

**Lore holds bytes for one reason: the machine is gone.** Bay's copies die with
the box. Rebuilding a VPS, or seeding a second outpost, needs an artifact from
somewhere that isn't a developer's laptop.

### Data model

`releases` currently mixes artifact identity with deployment state. Split it.

**`artifacts`** — what was built. Env-independent.

```
id, projectId, app, tag, sha256, fileId, sizeBytes, createdBy, createdAt
UNIQUE (projectId, app, tag)
```

**`deployments`** — an artifact placed on a target.

```
id, projectId, artifactId?, environment, outpostId, status,
failureReason, claimedAt, createdBy, createdAt
+ denormalised: app, tag, sha256
```

The denormalisation is load-bearing. When `hello:latest` is overwritten,
yesterday's deployment row must still say what it actually deployed. `artifactId`
is a soft pointer that may go null; `(app, tag, sha256)` is a permanent snapshot.
History survives pruning.

`outposts` and `outpostApps` are unchanged.

The timestamp keeps its job and loses its ambiguity: `2026-08-05-143022` is the
**deployment id**, which is what it always was on Bay's disk.

### Versioning and retention

**`latest` is the only mutable tag.**

- `tag = "latest"` → one row per `(projectId, app)`, replaced in place. The old
  R2 object is deleted on replace.
- any other tag → **write-once, kept forever.** Pruned only by a human or the
  MCP. Re-pushing errors; `--force` is the escape hatch for "I tagged the wrong
  commit".

This is Docker's *naming* with stricter *mutability* — the model ECR and GHCR
call tag immutability. It is what makes promote correct: the bytes cannot change
under a pinned tag between staging and production.

Moving tags other than `latest` (`nightly`, `staging`) are not supported in v1.
Adding them later is a list, not a redesign.

### CLI surface

- **`push --tag 3.0.0`** — build + upload. No deploy. Lore-only. *(new)*
- **`deploy --env <env> --tag 3.0.0`** — deploy an artifact **from the registry**,
  by tag. Never builds, never uploads. *(new behaviour, gated on `--tag`)*
- **`deploy --env <env>`** — unchanged from today: deploy whatever is in local
  `dist/`. Adding `--tag` is what switches it to registry mode, so no existing
  invocation changes meaning.
- **`up --env <env> [--tag]`** — `push` + `deploy`. Omitting `--tag` means
  `latest`, which is mutable, so the inner loop always rebuilds.

| Command | tag absent from registry | tag present |
|---|---|---|
| `up --env staging --tag 3.0.0` | build → push → deploy | **reuse** → deploy |
| `up --env production --tag 3.0.0` | build → push → deploy | **reuse** → deploy ← *promote* |

Promote is not a new verb: it is `up` again with the same tag against a different
env, with immutability guaranteeing identical bytes.

When `up` reuses an existing artifact, it must say so — *"deploying hello:3.0.0
(sha ab12…, pushed 3 days ago); local changes not included."* Silent reuse is the
only way this rule surprises anyone.

**Promote costs no transfer.** sha256 is already the key and Bay skips the fetch
for content it holds, so staging→production on one Bay is a symlink flip.

`push` stays Lore-only on purpose: it means "put an artifact in a registry", and
Cloudflare has none. If CF ever joins, it joins by using Lore as its registry,
and `push` starts working for it without changing meaning.

## Code changes

**`apps/lore`**
- New `artifacts` entity. `releases` is **renamed** to `deployments` (via
  `ALTER TABLE ... RENAME TO`, with a drizzle rename hint — a bare
  `db:generate` emits CREATE+DROP, which is data loss), then gains
  `artifactId` and loses the artifact-identity columns it no longer owns
  (`fileId`, `sizeBytes`), keeping `app`/`tag`/`sha256` as the denormalised
  snapshot.
- `ReleaseController` (`POST/GET/LIST /projects/:projectId/releases`) splits into
  artifact and deployment endpoints. The existing paths keep working — the
  deployed `LoreAdapter` in the wild is 0.25.0 and must not break the moment
  Lore ships.
- Retention on artifact upload: replace-in-place for `latest`, reject duplicate
  pinned tags unless forced.
- `rollback` added to `outpostCommands`.

**`packages/alepha` (CLI)**
- `LoreAdapter`: stop generating a timestamp as the version; send the pack tag.
  Resolve-or-build against the registry. Keep the timestamp as deployment id.
- `platform push` command; `--tag` on `deploy` and `up`.

**Migration (D1).** Nothing FKs onto `releases`, so no cascade-wipe risk — the
failure mode that cost lore-production once (2026-05-13). Still: prefer
CREATE + backfill + rename over `DROP TABLE`, and follow the hard rule in
`apps/lore/CLAUDE.md` before pushing.

## Testing

- Retention: pushing `latest` twice leaves one artifact and one R2 object;
  pushing a pinned tag twice errors, and `--force` replaces.
- Promote: deploying the same tag to two envs creates two deployments against
  one `artifactId` with one sha256.
- History survival: overwrite `latest`, assert the prior deployment row still
  reports its original `(app, tag, sha256)` with a null `artifactId`.
- Rollback: emits a command naming a Bay-retained release; uploads nothing.
- `up` reuse path logs the "local changes not included" warning.

## Out of scope

- **Secrets.** Bay already holds them per-app in `.env` and `bayOwnedKeys`
  guarantees user keys survive a redeploy untouched. A Lore-side store is its own
  project; `SecretStoreProvider` is already write-only (no `get`), so it is a
  third implementation, not a new architecture.
- **Cloudflare.** Untouched in v1. The shape if it ever joins: Lore holds desired
  state, Bay converges autonomously, Cloudflare converges when someone with
  wrangler runs `apply` — because `CloudflareAdapter` shells out to the wrangler
  binary for deploy and Lore runs on Workers and cannot shell out.
- **Clone prod → tmp env.** Parked. The primitives mostly exist (arbitrary envs
  with own DB/storage/subdomain on Bay, `teardown` per env, `exportDb` on the
  contract). The unresolved part is data: cloning production rows into a
  throwaway env with a guessable subdomain is a PII decision, not a plumbing one.
- **bay-admin / BayAdapter eradication.** A separate chore.
