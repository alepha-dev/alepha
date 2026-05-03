# Vendor Plugin

Keep local copies of Alepha packages inside your project. Audit source code, apply quick patches, or work offline with a stable snapshot.

## Quick Start

Register the plugin in `alepha.config.ts`:

```typescript filename=alepha.config.ts
import { defineConfig } from "alepha/cli/config";
import { AlephaCliVendor } from "alepha/cli/vendor";

export default defineConfig({
  services: [AlephaCliVendor],
  vendor: {
    packages: ["alepha"],
  },
});
```

```bash
alepha vendor sync
```

Your `packages/` directory now contains the vendored source. Your workspace resolves these local copies instead of the published npm packages.

## What It Does

The vendor plugin clones the Alepha repository, copies the packages you specify into your project, strips test files and build artifacts, and runs `install` so everything resolves correctly.

Use cases:

- **Auditing** -- review Alepha internals without trusting a published package
- **Patching** -- fix a bug locally before the next release
- **Offline work** -- develop without network access to the registry
- **Compliance** -- meet corporate policies that require vendored dependencies

## Options

| Flag | Description |
|------|-------------|
| `--force`, `-f` | Skip local modification check and overwrite (`sync` only) |

## Configuration

Register the plugin and list the packages you want to vendor in `alepha.config.ts`:

```typescript filename=alepha.config.ts
import { AlephaCliVendor } from "alepha/cli/vendor";
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  services: [AlephaCliVendor],
  vendor: {
    packages: ["alepha", "@alepha/payments-stripe"],
  },
});
```

### Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `packages` | `string[]` | -- | Package directory names to vendor (required) |
| `remote` | `string` | Alepha git remote | Git remote URL to clone from |
| `branch` | `string` | `"main"` | Branch to sync from |

## Commands

### sync

Replace local vendored packages with the latest remote source.

```bash
alepha vendor sync
```

The command:

1. Shallow-clones the remote repository
2. Checks for local modifications (aborts if found)
3. Replaces each package directory under `packages/`
4. Removes test files and build artifacts
5. Runs the package manager install

> **Local Changes Protection**
>
> If you have local modifications, `sync` aborts and shows a diff. Use `--force` to overwrite.

### diff

Compare local packages against the remote HEAD.

```bash
alepha vendor diff
```

Shows file-level changes per package -- added, modified, and removed files -- with a summary of total changes.

> **Before Syncing**
>
> Run `diff` before `sync` to see what changed upstream, or to verify that your local patches are still intact.

## Ignored Files

The plugin automatically strips non-production files during sync and diff:

**Files:** `*.spec.ts`, `*.spec.tsx`, `LICENSE`

**Directories:** `__tests__/`, `node_modules/`, `dist/`, `assets/swagger-ui/`

These are removed after copying so the vendored packages contain only source code.

## Workflow

A typical workflow:

```bash
# Initial vendor
alepha vendor sync

# Check what changed upstream since last sync
alepha vendor diff

# Pull latest (if no local patches)
alepha vendor sync

# Pull latest (overwrite local patches)
alepha vendor sync --force
```

## Tips

**Run `diff` before `sync`.** Always check what changed upstream before pulling. You don't want to overwrite a local fix.

**Commit after syncing.** Vendor updates should be their own commit. This makes it easy to revert if something breaks.

**Keep patches small.** The fewer local changes, the easier it is to sync upstream updates. File issues for fixes you want upstreamed.

**Use `--force` sparingly.** It discards all local modifications. Make sure you've committed or stashed your patches first.
