# Alepha - Cli Vendor

## Installation

Part of the `alepha` package. Import from `alepha/cli/vendor`.

```bash
npm install alepha
```

## Overview

CLI plugin for vendoring Alepha packages into external projects.

Copies package source code from a git remote into the current project's
vendor directory (`.vendor/` by default). Useful for corporate projects that need a local
copy of Alepha for AI tooling, audits, documentation, or quick fixes.

Commands:
- `alepha vendor sync`  — replace local packages with remote source
- `alepha vendor diff`  — compare local packages against remote HEAD

Configuration in `alepha.config.ts`:

```typescript
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

