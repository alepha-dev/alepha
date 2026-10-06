# CLAUDE.md: apps/e2e

The end-to-end suites (#Q2628). They drive built artefacts and import no `apps/lore/src`: a pure helper they need comes from a package's barrel or its own subpath (`@lore/work/schemas`, `@lore/deploy/testing/tarball`), never from a barrel that renders React, which Playwright's loader cannot import.

| folder | suite                                                                  | run                                                                                                           |
| ------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `web/` | Playwright, against `apps/lore/dist` started once per worker           | `yarn e2e` from the root (CI: `e2e-lore`, 6 shards, `yarn w e2e web --shard=n/6`), after `yarn w lore build`  |
| `cli/` | Vitest: the packed `lore` binary, and the real Bay against a real Lore | `yarn e2e-cli` from the root, after `yarn build`, with a Bay checkout (`BAY_DIR`, else `.bay`, else `../bay`) |

`yarn w e2e web <spec>` runs one Playwright file, `yarn w e2e web:ui` the UI mode. The suites are out of the root `yarn test` on purpose (`check:conventions` exempts this workspace), and `apps/e2e` is exempt from the `describe` + `it` rule because Playwright has no `it`.

## ⚠️ Running e2e while another agent is running it

This suite used to run on **3303 — the same port as `yarn dev`**. With `reuseExistingServer` on, a dev server left running in another terminal was adopted by Playwright, and the whole suite ran against hot-reloaded sources and the dev database instead of `node dist` and `:memory:`. Two agents in two worktrees hit the same trap through each other's servers.

`scripts/playwright.port.ts` — shared by all six Playwright configs, same pattern as `vitest.projects.ts` — makes both impossible. E2E allocates from a reserved **4300-4999** band that no dev server may use; within it the slot is derived from the **checkout path**, so two worktrees never meet; and the port is then **bind-tested**, stepping a full stride if anything answers. `reuseExistingServer` is `false` everywhere as a result: a port verified free has nothing legitimate to adopt.

⚠️ **Lore asks for `e2eWorkerPort("lore", workerIndex)`, not `e2ePort("lore")`** — one port per Playwright worker, because it boots one server per worker (below). Each worker probes a **disjoint subsequence** of the same candidate list, which is not the same thing as rotating one shared list to a different start: that was the first implementation and it let a worker whose first choice was busy advance onto the base the next worker started from, so 14 workers produced 13 ports and one instance failed to bind for no visible reason. `playwright.port.spec.ts` holds the regression.

`E2E_PORT` overrides the whole thing, probe included. Reach for it when the allocation cannot help — most often a worktree checked out _before_ this landed, which still carries the old fixed-3303 config. Pick something inside the e2e band:

```bash
E2E_PORT=4999 yarn w e2e web quest.spec.ts
```

Before killing anything on a busy port, check whose it is — `lsof -a -p <pid> -d cwd`. A `node dist` whose cwd sits under `.claude/worktrees/` belongs to another agent's run.

## One Lore instance per worker, and why `fullyParallel` is on

`apps/e2e/web/_fixtures.ts` boots `node dist` **per Playwright worker**, each on its own
`DATABASE_URL=:memory:` and its own `DATA_DIR`, and hands every spec a `baseURL`
pointing at its worker's instance. There is no `webServer` block and no
`global-setup.ts` any more; both existed to serve the single shared server.

**Every spec therefore imports `test` from `./_fixtures.ts`, never from
`@playwright/test`.** A spec that imports the bare Playwright `test` gets no
server, no `baseURL` and a confusing failure.

Why it is worth it: the suite used to share one server, one database, one realm
and one mail directory, so `fullyParallel` could not be turned on, so tests
inside a file ran one after another. `quest.spec.ts` and `folio-workspace.spec.ts`
hold 23 tests each, and one of those files running serially set the wall clock
for the entire `yarn e2e` step across every app. Measured:

|                                | before | after |
| ------------------------------ | ------ | ----- |
| lore e2e, 133 tests, 7 workers | 228s   | ~126s |
| `yarn v` e2e step, every app   | 234.5s | ~130s |
| `yarn v`, whole pipeline       | ~465s  | ~345s |

It is affordable because a Lore instance answers **325-386ms** after spawn and
holds **~168MB**, so seven cost about a second of startup and 1.2GB.

⚠️ **More workers does NOT help.** On a clean Lore-only run, 10 workers failed 10
tests and 14 failed 15, both in registration and sign-in timeouts at ~450-490%
CPU. The limit is CPU per Chromium-plus-server pair, not shared state, so private
instances make parallelism safe without making it bigger. The default (half the
logical cores) is already the right number, and raising it is the wrong lever.

⚠️ **`node dist`, never `yarn start`.** That script is `yarn build && node dist`,
so the fixture would rebuild the app once per worker. The build must already have
happened, which under `yarn v` it has; running `yarn e2e` by hand in a tree with
no `dist` needs a `yarn build` first.

⚠️ **Read mail through `emailDirOf()`, never a captured constant.** Each worker
has its own `DATA_DIR`, so a shared `emailDir` would have every worker reading
every other worker's verification codes.

**The biggest remaining cost is per-test registration**, and it is measured so it
need not be guessed at: `registerAndVerify` is ~2.6s and `createProjectViaWizard`
~2.5s against a mean test of ~6.3s, so about four fifths of a test is setup.
Reaching the same end state from a session reused per worker took 2665ms against
5117ms. Applying that means changing 124 call sites and is its own change.

## E2E convention: one file per feature

`apps/e2e/web/` is split by feature, not by user journey. One `<feature>.spec.ts` per major surface, each covering happy path + key edge cases:

- `apps.spec.ts` - create a deployed copy → mint its sigil → ingest as it → triage in the inbox → open it from the Apps list → walk its tabs → rename a half → rotate → delete. Renamed from `sigil.spec.ts` with epic #30
- `blights.spec.ts` - regression guard for the inbox render loop (the ingest path lives in `apps.spec.ts`)
- `estates.spec.ts` - the owner's `/account/estates` page (create with the one-time secret, a switch that follows the server's answer, a restart that queues `pending` with no machine connected, delete through the dialog that says nothing is undeployed) and the admin `/admin/estates` list, which shows no credential. No machine connects here: that is #1624 and #1628
- `quest.spec.ts` — quest lifecycle (open → accept → complete) + reminder UI
- `quest-comments.spec.ts` — the Discussion: post / list / edit / delete and the membership gate
- `feedback.spec.ts` — feedback submit → accept → link quests → status progression (renamed from `petition.spec.ts`)
- `register.spec.ts` — registration form + email verification
- `settings-features.spec.ts` - the capability switches in General ▸ Capabilities and on the section pages
- `capabilities.spec.ts` - a Knowledge-only project, an Apps-only one, and a project with everything turned off and Work turned back on
- `theme-flicker.spec.ts` — theme no-flash boot
- `invitation.spec.ts` — owner invites → user accepts → joins project as a member (drives the email-link round-trip)
- `protected-folio.spec.ts` — end-to-end encrypted folios (passphrase round-trip, wrong-passphrase rejection, no plaintext on the wire)
- `quest-export.spec.ts` — Data settings page CSV export. Renamed from `quest-import-export.spec.ts` when quest import was deleted in epic #E48; it only ever held the export test
- `folio-workspace.spec.ts` — the whole folio surface (summary round-trip, inspector tabs, tree drag-move, find, focus mode, pane persistence, creating from the tree); `folios.spec.ts` was deleted with the directory table it drove
- `project-wizard.spec.ts` — 3-step create wizard (renamed from `campaign-wizard.spec.ts`)
- `members.spec.ts` — settings members list, identity hover-card, dead `/character` + `/roster` URLs 404
- `account.spec.ts` — the `/account` area (Lore's consumer of `@alepha/ui`'s `AccountRouter`, a root shell with a floating sidebar since #E68): lands on the profile, the sidebar lists the five built-in pages **and** Lore's `$pageAccount` ones with exactly one lit per page, the mobile sheet, the signed-out redirect, rename round-trip, password change, sessions, API-key create/reveal-once/revoke, and delete-account refused while a project is owned. ⚠️ The rename test waits for the success toast **before** reloading — without it the reload races the save and the assertion fails for the wrong reason
- `roadmap.spec.ts` — the roadmap from its three audiences: a stranger with no account (through Playwright's isolated `request` fixture, never the page — the page's `fetch` carries the session bearer, so a page-driven "anonymous" request proves nothing), a member, and the crawler case (real HTML carrying the release tags, asserted against a Googlebot user agent). ⚠️ It creates **three projects at three visibilities** and never flips one: the response carries `max-age=60`, so "flip to off, ask again, expect 404" would be flaky for a reason a retry does not fix
- `home.spec.ts`, `admin-user-detail.spec.ts` (its only test has been `test.skip` since 2026-05-28), `areas.spec.ts`, `dashboard.spec.ts`, `epics.spec.ts`, `releases.spec.ts` (many open at once, attach an epic and a loose quest, publish freezes the counts, `0.9.0` sorts before `0.10.0`), `quests-status-seed.spec.ts`, `admin-analytics.spec.ts`
- `security-public-project.spec.ts` — regression guard: non-member account hits 403 on every project endpoint after the public-project purge (renamed from `security-public-campaign.spec.ts`)
- `security-file-access.spec.ts` — regression guard: `/api/files/:id` IDOR fix via `LoreFileAccessProvider` (only owners/members can download an attachment)
- `device-login.spec.ts` - `lore login` from the human's side: a signed-out visitor opens the device link, signs in, lands back on `/oauth/device` through the login bridge and `/oauth/continue`, approves, and the device's token answers `/api/users/me` as that account; then a signed-in visitor types a code by hand and denies it. The device half goes through Playwright's isolated `request` fixture, the way the CLI talks to Lore
- `project-slug.spec.ts` — the URL identity: the wizard lands on a slug derived from the title, renaming shows the confirmation and moves the URL (cancel reverts the field), the old slug 404s, `/p/:id` 404s, and a taken name is refused with a visible message. ⚠️ The Name field does **not** auto-commit — the form has a real Save button in the settings card's last row, disabled until something is dirty. A spec that only types saves nothing

Shared setup (register/verify, project-create wizard, API helpers) lives in `apps/e2e/web/_helpers.ts`. Re-use those rather than copy-pasting auth setup into each new spec.

`setProjectFeature(page, projectId, key, value?)` flips a project feature toggle from inside a flow — use it when a spec needs an off-by-default module (e.g. `questReminder`). It replaced the old `unlockShopFeature`, which farmed gold from a throwaway quest to fund a Shop purchase; the Shop no longer exists.

**When adding or modifying a feature, the matching `<feature>.spec.ts` must move with it.** No feature ships without its e2e moving in lockstep. If no spec exists yet for the feature, create one — start by composing `registerAndVerify` + `createProjectViaWizard` from `_helpers.ts`, then drive the feature-specific UI.
