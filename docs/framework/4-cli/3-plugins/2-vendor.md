# Vendor Plugin

Keep local copies of Alepha packages inside your project. Audit source code, apply quick patches, or work offline with a stable snapshot.

## Quick Start

Register the plugin in `alepha.config.ts` with the `vendor()` helper:

```typescript check filename=alepha.config.ts
import { defineConfig } from "alepha/cli/config";
import { vendor } from "alepha/cli/vendor";

export default defineConfig({
  plugins: [
    vendor({
      packages: ["alepha"],
    }),
  ],
});
```

```bash
alepha vendor sync
```

Your `.vendor/` directory now contains the vendored source, plus a `vendor.json` lock file recording the remote and the exact commit that was synced.

## What It Does

The vendor plugin shallow-clones the Alepha repository, copies the packages you specify into your project's vendor directory (`.vendor/` by default), strips test files and build artifacts, records the synced commit in `vendor.json`, and runs your package manager's `install` so everything resolves correctly.

Use cases:

- **Auditing** — review Alepha internals without trusting a published package
- **AI tooling** — give agents the full framework source to read alongside your app
- **Patching** — fix a bug locally before the next release
- **Offline work** — develop without network access to the registry
- **Compliance** — meet corporate policies that require vendored dependencies

## Configuration

`vendor()` accepts the following options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `packages` | `string[]` | — | Package directory names to vendor (required) |
| `remote` | `string` | `"https://github.com/feunard/alepha"` | Git remote URL to clone from |
| `branch` | `string` | `"main"` | Branch to sync from |
| `dir` | `string` | `".vendor"` | Directory holding the vendored packages (relative to project root); also where `vendor.json` is written |

```typescript check filename=alepha.config.ts
import { defineConfig } from "alepha/cli/config";
import { vendor } from "alepha/cli/vendor";

export default defineConfig({
  plugins: [
    vendor({
      branch: "main",
      packages: ["alepha", "@alepha/payments-stripe"],
    }),
  ],
});
```

## Commands

### sync

Replace local vendored packages with the latest remote source.

```bash
alepha vendor sync
```

The command:

1. Compares your local copy against the last-synced commit (from `vendor.json`) and aborts if you have local modifications
2. Shallow-clones the remote repository at the configured branch
3. Replaces each package directory under the vendor directory
4. Removes test files and build artifacts
5. Updates `vendor.json` with the new commit hash
6. Runs the package manager install

| Flag | Description |
|------|-------------|
| `--force`, `-f` | Skip the local modification check and overwrite |
| `--remote` | Override the configured remote for this invocation; accepts any git-clone URL, including local paths (`file:///abs/path/to/alepha`) |

> **Local Changes Protection**
>
> If you have local modifications since the last sync, `sync` aborts and shows a diff. Use `--force` to overwrite.

### diff

Show your local modifications since the last sync.

```bash
alepha vendor diff
```

Reads the commit hash from `vendor.json`, clones the remote at that exact commit, and compares your local files against it. Shows file-level changes per package — added, modified, and removed files — with line-level detail for modifications. If you have never synced, it reports no changes.

> **Before Syncing**
>
> Run `diff` before `sync` to verify which local patches you still carry — those are exactly what a plain `sync` refuses to overwrite.

## The Lock File

Each sync writes `<dir>/vendor.json`:

```json
{
  "remote": "https://github.com/feunard/alepha",
  "commit": "e55f17563..."
}
```

This pins the baseline used by `diff` and the local-modification check, and lets any downstream tool (CI script, AI agent) re-fetch the same sources without reading your `alepha.config.ts`.

## Ignored Files

The plugin strips non-production files during sync and ignores them during diff:

**Files:** `*.spec.ts`, `*.spec.tsx`, `LICENSE`, `tsdown.config.ts`

**Directories:** `__tests__/`, `node_modules/`, `dist/`, `assets/swagger-ui/`

The vendored packages contain only source code.

## Workflow

A typical workflow:

```bash
# Initial vendor
alepha vendor sync

# Check which local patches you carry
alepha vendor diff

# Pull latest (aborts if local patches exist)
alepha vendor sync

# Pull latest (overwrite local patches)
alepha vendor sync --force
```

## Tips

**Run `diff` before `sync`.** Know which local patches you're carrying before pulling — `--force` discards them all.

**Commit after syncing.** Vendor updates should be their own commit. This makes it easy to revert if something breaks.

**Keep patches small.** The fewer local changes, the easier it is to sync upstream updates. File issues for fixes you want upstreamed.

**Use `--force` sparingly.** It discards all local modifications. Make sure you've committed or stashed your patches first.
