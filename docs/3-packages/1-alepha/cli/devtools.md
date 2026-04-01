# Alepha - Cli Devtools

## Installation

Part of the `alepha` package. Import from `alepha/cli/devtools`.

```bash
npm install alepha
```

## Overview

CLI plugin that integrates @alepha/devtools into the Vite dev server.

This module is intentionally lightweight — it does NOT statically import
`@alepha/devtools` (which pulls in `alepha/react` and `.tsx` files).
Instead, it lazy-loads devtools via Vite's SSR module loader at runtime.

Usage in `alepha.config.ts`:
```ts
import { AlephaCliDevtoolsPlugin } from "alepha/devtools/plugin";

export default defineConfig({
  services: [AlephaCliDevtoolsPlugin],
});
```

