# @alepha/lore - Cli

## Installation

```bash
npm install @alepha/lore
```

## Overview

CLI plugin for talking to a Lore instance from a build or a CI job.

The other half of this package reports from a running app; this half is what
a pipeline runs. It lives here rather than in `alepha/cli` because Lore is a
superset of Alepha and no Lore code belongs inside the framework, and it is
a subpath rather than a package of its own so that both halves share one
answer to "where is Lore, and how do I authenticate to it".

Registered from `alepha.config.ts`, the same way `alepha/cli/vendor` is:

```typescript
import { lore } from "@alepha/lore/cli";

export default defineConfig({
  plugins: [lore({ project: "alepha" })],
});
```

⚠️ This subpath carries no `browser` export condition, on purpose. A bundler
that resolves it has wandered somewhere it does not belong, and should fail
on the first `node:` import rather than be handed a stub.
