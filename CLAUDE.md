# CLAUDE.md

This repository holds three products side by side (#Q2765, folio #F1398 of the Alepha project):

| folder       | product                                     | read first            | Lore areas                     |
| ------------ | ------------------------------------------- | --------------------- | ------------------------------ |
| `framework/` | Alepha, the framework (`alepha`, `@alepha/ui`, ...) | `framework/CLAUDE.md` | `alepha/*`, `@alepha/*`, `cli` |
| `lore/`      | Lore, the app, its CLI and its modules      | `lore/CLAUDE.md`      | `lore/*`                       |
| `bay/`       | Bay, the Go application server              | `bay/CLAUDE.md`       | `bay`                          |
| `docs/`      | alepha.dev, the site documenting all three   | this file             | `docs`                         |

All three products are planned in ONE Lore project, **Alepha** (`https://lore.alepha.dev/alepha`, id `1`), since #E94 (2026-10-27): a quest says which product it is for by its `area`. A change spanning two products takes the area of the one it is for, and names the other in its description. The projects `Lore` (id `74`) and `Bay` (id `75`) are archived; a number either used after 2026-10-01 that project 1 already held was renumbered, and folios #F1422 (Lore) and #F1427 (Bay) map the old number to the new one.

## One install, three checks

- **One Yarn project.** The root `package.json` lists `framework`, `lore` and `docs` as workspaces; each of them declares its own `workspaces`, which makes it a Yarn **worktree**. There is one `yarn.lock` and one `node_modules`, at the root. Never add a `yarn.lock` or a `.yarnrc.yml` under a product.
- **`yarn v` is scoped by the folder you run it in.** Every fan-out uses `yarn workspaces foreach -W` (the current worktree), never `-A`, which would reach every product. `cd framework && yarn v` checks the framework only, `cd lore && yarn v` Lore only.
- **Lore builds on the framework's source.** `alepha` and `@alepha/ui` resolve to `framework/packages/*` by `workspace:*`: there is no vendored copy and no sync. A framework change and the Lore change that needs it land in one commit.
- `resolutions`, `packageManager` and `.yarnrc.yml` exist at the root only: Yarn ignores them anywhere else.
- Bay is a Go module, not a workspace: `cd bay && go test ./...`.

## CI

Workflows live in the root `.github/workflows/`, one set per product, each scoped by `paths` and running its steps in its folder (`defaults.run.working-directory`):

- **Verify Framework** (`verify-framework.yml`): `framework/**` and the shared root files. Green on `main`, it triggers **Deploy Framework** (`deploy-framework.yml`: ui.alepha.dev, shop.alepha.dev).
- **Verify Lore** (`verify-lore.yml`): `lore/**`, `framework/**` and `bay/**`, since Lore builds on the framework's source and its e2e builds Bay. Green on `main`, it triggers **Deploy Lore** (`deploy-lore.yml`: lore.alepha.dev).
- **Verify Bay** (`verify-bay.yml`): `bay/**`.
- **Verify All** (`verify-all.yml`): the three above at once, by hand only (`gh workflow run verify-all.yml --ref <branch>`). It deploys nothing: the deploys follow the other three by name, and a called run is filed under "Verify All".
- **Docs** (`docs.yml`): `docs/**` and every product's `docs/`. It deploys alepha.dev on `main`, each section from how its product ships (#Q2766): the framework and Bay from the latest release tag (`yarn pin`, then `DOCS_RELEASE_ROOT`), Lore from `main`.

- **Deploy All** (`deploy-all.yml`): Deploy Framework, Deploy Lore and Docs at once, by hand, from `main` only (`gh workflow run deploy-all.yml --ref main`). It ships `main` as it stands without waiting for a Verify, as each deploy file's own dispatch does; never use it over a Lore migration Verify Lore has not run on `main`. Bay is deployed by no workflow.

The Release commit is pushed with `GITHUB_TOKEN`, which triggers no workflow, so Verify Framework and Verify Lore also run when **Release** completes, and their deploys follow on `main`.

**One release for everything** (#Q2776): `release.yml`, dispatched by hand, gives the framework, Lore and Bay one version and one bare `x.y.z` tag. It publishes the framework's packages and `@alepha/lore` to npm (trusted publishing names `release.yml` for all of them), pushes `ghcr.io/alepha-dev/lore`, attaches Bay's binaries and `SHA256SUMS` to the GitHub release, publishes the Lore release of that version in projects `alepha`, `lore` and `bay`, and deploys alepha.dev. The framework's `CHANGELOG.md` stays framework-only.

A step's own `working-directory` is relative to the repository root, so it names the product folder (`framework/apps/ui`).

## The workflow

The framework's rules apply to the whole repository: a worktree per epic, small commits staged by explicit path, each naming its quest as `#Q<n>`, push the branch to verify, merge to main when green. See "The workflow" in `framework/CLAUDE.md`.
