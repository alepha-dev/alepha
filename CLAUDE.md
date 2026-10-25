# CLAUDE.md

This repository holds three products side by side (#Q2765, folio #F1398 of the Alepha project):

| folder       | product                                     | read first            | Lore project       |
| ------------ | ------------------------------------------- | --------------------- | ------------------ |
| `framework/` | Alepha, the framework (`alepha`, `@alepha/ui`, ...) | `framework/CLAUDE.md` | `Alepha`, id `1`   |
| `lore/`      | Lore, the app, its CLI and its modules      | `lore/CLAUDE.md`      | `Lore`, id `74`    |
| `bay/`       | Bay, the Go application server              | `bay/CLAUDE.md`       | `Bay`, id `75`     |

File quests and folios in the project of the product the work changes. A change spanning two products goes in the project of the one it is for, and names the other in its description.

## One install, three checks

- **One Yarn project.** The root `package.json` lists `framework` and `lore` as workspaces; each of them declares its own `workspaces`, which makes it a Yarn **worktree**. There is one `yarn.lock` and one `node_modules`, at the root. Never add a `yarn.lock` or a `.yarnrc.yml` under a product.
- **`yarn v` is scoped by the folder you run it in.** Every fan-out uses `yarn workspaces foreach -W` (the current worktree), never `-A`, which would reach every product. `cd framework && yarn v` checks the framework only, `cd lore && yarn v` Lore only.
- **Lore builds on the framework's source.** `alepha` and `@alepha/ui` resolve to `framework/packages/*` by `workspace:*`: there is no vendored copy and no sync. A framework change and the Lore change that needs it land in one commit.
- `resolutions`, `packageManager` and `.yarnrc.yml` exist at the root only: Yarn ignores them anywhere else.
- Bay is a Go module, not a workspace: `cd bay && go test ./...`.

## CI

Workflows live in the root `.github/workflows/`, one set per product, each scoped by `paths` and running its steps in its folder (`defaults.run.working-directory`):

- `verify.yml` (framework): `framework/**` and the shared root files.
- `lore-verify.yml`: `lore/**`, `framework/**` and `bay/**`.
- `bay-ci.yml`: `bay/**`.

A step's own `working-directory` is relative to the repository root, so it names the product folder (`framework/apps/ui`).

## The workflow

The framework's rules apply to the whole repository: a worktree per epic, small commits staged by explicit path, each naming its quest as `#Q<n>`, push the branch to verify, merge to main when green. See "The workflow" in `framework/CLAUDE.md`.
