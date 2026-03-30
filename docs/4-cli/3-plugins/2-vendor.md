# Vendor Plugin

The vendor plugin keeps local copies of Alepha packages inside your project. This lets you audit source code, apply quick patches, or work offline with a stable snapshot.

Install it as a dev dependency:

```bash
npm install -D @alepha/vendor
```

Once installed, the `alepha vendor` command becomes available.

## Why Vendor?

Sometimes you need the framework source in your own repository:

- **Auditing** -- review Alepha internals without trusting a published package
- **Patching** -- fix a bug locally before the next release
- **Offline work** -- develop without network access to the registry
- **Compliance** -- meet corporate policies that require vendored dependencies

The plugin clones the Alepha repository, copies the packages you specify into your project, strips test files and build artifacts, and runs `install` so everything resolves correctly.

## Configuration

Register the plugin and list the packages you want to vendor in `alepha.config.ts`:

```typescript
import { AlephaCliVendor } from "alepha/cli/vendor";
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  services: [AlephaCliVendor],
  vendor: {
    packages: ["alepha", "@alepha/bucket-s3"],
  },
});
```

### Options

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

If you have local changes and want to discard them:

```bash
alepha vendor sync --force
```

The `--force` flag skips the modification check and overwrites unconditionally.

### diff

Compare local packages against the remote HEAD.

```bash
alepha vendor diff
```

Shows file-level changes per package -- added, modified, and removed files -- with a summary of total changes. Useful before syncing to see what has changed upstream, or to verify that your local patches are still intact.

## Ignored Files

The plugin automatically strips non-production files during sync and diff:

**Files:** `*.spec.ts`, `*.spec.tsx`, `LICENSE`

**Directories:** `__tests__/`, `node_modules/`, `dist/`, `assets/swagger-ui/`

These are removed after copying so the vendored packages contain only source code.

## Workflow

A typical workflow looks like this:

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

After syncing, your `packages/` directory contains the vendored source. Your workspace resolves these local copies instead of the published npm packages.
