# AGENTS.md

This repository holds three products side by side (#Q2765, folio #F1398 of the Alepha project):

| folder       | product                                     | read first            | Lore areas                     |
| ------------ | ------------------------------------------- | --------------------- | ------------------------------ |
| `framework/` | Alepha, the framework (`alepha`, `@alepha/ui`, ...) | `framework/AGENTS.md` | `alepha/*`, `@alepha/*`, `cli` |
| `lore/`      | Lore, the app, its CLI and its modules      | `lore/AGENTS.md`      | `lore/*`                       |
| `bay/`       | Bay, the Go application server              | `bay/AGENTS.md`       | `bay`                          |
| `docs/`      | alepha.dev, the site documenting all three   | this file             | `docs`                         |

All three products are planned in ONE Lore project, **Alepha** (`https://lore.alepha.app/alepha`, id `1`), since #E94 (2026-10-27): a quest says which product it is for by its `area`. A change spanning two products takes the area of the one it is for, and names the other in its description. The projects `Lore` (id `74`) and `Bay` (id `75`) are archived; a number either used after 2026-10-01 that project 1 already held was renumbered, and folios #F1422 (Lore) and #F1427 (Bay) map the old number to the new one.

## One install, three checks

- **One Yarn project.** The root `package.json` lists `framework`, `lore` and `docs` as workspaces; each of them declares its own `workspaces`, which makes it a Yarn **worktree**. There is one `yarn.lock` and one `node_modules`, at the root. Never add a `yarn.lock` or a `.yarnrc.yml` under a product.
- **`yarn v` is scoped by the folder you run it in.** Every fan-out uses `yarn workspaces foreach -W` (the current worktree), never `-A`, which would reach every product. `cd framework && yarn v` checks the framework only, `cd lore && yarn v` Lore only.
- **Lore builds on the framework's source.** `alepha` and `@alepha/ui` resolve to `framework/packages/*` by `workspace:*`: there is no vendored copy and no sync. A framework change and the Lore change that needs it land in one commit.
- `resolutions`, `packageManager` and `.yarnrc.yml` exist at the root only: Yarn ignores them anywhere else.
- Bay is a Go module, not a workspace: `cd bay && go test ./...`.

## CI

Four workflows, in the root `.github/workflows/` (#Q3832): **Verify**, **Deploy**, **Release** and **Nightly**. A product's jobs run their steps in its folder (`defaults.run.working-directory`).

- **Verify** (`verify.yml`): every pull request into `main`, every merge queue group and every push to `main`. Its `changes` job works out which products the change touches, and each product's jobs (`framework-*`, `lore-*`, `bay-check`, `docs-check`) skip when it touches none of their part of the tree: the framework is `framework/**` and the shared root files; Lore is `lore/**`, `framework/**` and `bay/**`, since it builds on the framework's source and its e2e builds Bay; Bay is `bay/**`; the docs are `docs/**` and every product's `docs/`. Each product ends in its `gate` job, which always reports: the `main` ruleset requires `gate (framework)`, `gate (lore)`, `gate (bay)` and `gate (docs)`, and nothing else (#Q3633). A new job joins its product's gate `needs`, or the ruleset never waits for it. By hand (`gh workflow run verify.yml --ref <branch>`) it runs every product and deploys nothing.
- **Deploy** (`deploy.yml`): lore.alepha.app (`lore`), ui.alepha.dev and shop.alepha.dev (`framework`), and alepha.dev with latest.alepha.dev (`docs`). On a push to `main`, Verify calls it once per touched product whose gate is green, so a red Bay never holds Lore back, and the framework apps and the docs wait for Lore's deploy, since they deploy through Lore with the commit's own `lore` CLI. alepha.dev builds each section from how its product ships (#Q2766): the framework and Bay from the latest release tag (`yarn pin`, then `DOCS_RELEASE_ROOT`), Lore from `main`; latest.alepha.dev builds every section from `main`, for projects that vendor Alepha (#Q3028). By hand, from `main` only, it ships `main` as it stands without waiting for Verify: `gh workflow run deploy.yml --ref main -f target=all` (or `lore`, `framework`, `docs`); never over a Lore migration Verify has not run on `main`. No deploy is ever cancelled. Bay is deployed by no workflow.
- **The merge queue** (#Q3688): `main`'s ruleset requires it, with the four `gate (<product>)` jobs as its checks, and merges by rebase (#Q3706). A pull request green on its own joins the queue, and Verify runs again on `merge_group`, on top of `main` and of every pull request queued ahead; its `changes` job diffs the group's commits. A queue run deploys nothing. The queue moves `main` to the very commit it tested, so the push to `main` that follows skips every check job and only deploys (#Q3834); a push the queue never tested runs the full Verify.
- **Nightly** (`nightly.yml`): every product's Verify, whatever changed, then the coverage the Quality tab reads, pushed to Lore, Lore's whole suite on Postgres, and the CLI on Windows.

**A flaky job on `main`**: "Re-run failed jobs" on the Verify run reruns it, and the deploys it skipped.

**Release writes nothing to `main`** (#Q3640): it is tag-driven, so it dispatches no Verify and no deploy either, because the commit it tags was verified and deployed when it landed.

**One release for everything** (#Q2776): `release.yml`, dispatched by hand, gives the framework, Lore and Bay one version and one bare `x.y.z` tag. The version is the latest release tag plus the bump, set in the published `package.json` files on the runner only and never committed: the `version` fields on `main` are not the released version, the tag is. It publishes the framework's packages and `@alepha/lore` to npm (trusted publishing names `release.yml` for all of them), pushes `ghcr.io/alepha-dev/lore`, attaches Bay's binaries and `SHA256SUMS` to the GitHub release, publishes the Lore release of that version in projects `alepha`, `lore` and `bay`, and deploys alepha.dev. The release notes are the Lore release (alepha.dev/changelog reads them too); there is no `CHANGELOG.md`. The one thing it pushes is the tag. `dry_run: true` runs every check and build and publishes nothing, listing what would have shipped in the run summary: `gh workflow run release.yml --ref main -f dry_run=true`.

A step's own `working-directory` is relative to the repository root, so it names the product folder (`framework/apps/ui`).

## The workflow

The framework's rules apply to the whole repository (#Q3706): one pull request for an epic, one for a run of loose quests, one per quest otherwise; one commit per quest, staged by explicit path and naming its quest as `#Q<n>`; every pull request rebase-merged through the merge queue with auto-merge on (`gh pr merge --auto --rebase`), so CI runs before the merge and `main` receives one commit per quest. Nothing is pushed to `main` directly. A worktree goes under `.claude/worktrees/<name>` at the repository root, never in a sibling folder of the checkout. See "The workflow" in `framework/AGENTS.md`.

## What the repository may name

The repository is public. Two rules hold in every file, in every product (#Q3117):

- **Never name an external project.** No app, client or side project outside this repository appears anywhere: not in docs, JSDoc, comments, CLI help, error messages, UI strings, test names or fixtures, AGENTS.md files or workflow comments. Lore, Bay and Alepha are the only projects that may be named. Say what the case is instead ("a downstream app", "a multi-tenant app", "a point-of-sale app"), and use neutral slugs in examples and fixtures (`acme`, `myapp`, `crm`, `example.app`), never a real project's name, domain or tenant.
- **Lore references stay out of user docs.** `#Q`, `#E`, `#F`, `Q2607`, "epic E9" and links to `lore.alepha.app/alepha/{quests,epics,folios}` are welcome in code comments and commit messages, and never in what a user reads as documentation: the guides under every product's `docs/`, README files, and the JSDoc that generates `framework/docs/2-reference` and `framework/docs/3-packages`. Lore's own guides may show the `#Q12` syntax, since documenting it is their subject. Internal planning (who reserved what, which epic gates which) is not user documentation either, with or without a number.
