# Devtools Plugin

An inspection UI for your running app, one click away during development. The devtools plugin wires `@alepha/devtools` into the Vite dev server: a floating button in the corner of your app opens an overlay with the full devtools UI.

## Quick Start

Projects scaffolded by `alepha init` already have it — the dependency and the config line are generated for you (opt out with `alepha init --no-devtools`). To add it manually:

```bash
npm install --save-dev @alepha/devtools
```

```typescript filename=alepha.config.ts
import { defineConfig } from "alepha/cli/config";
import { devtools } from "alepha/cli/devtools";

export default defineConfig({
  plugins: [devtools()],
});
```

Run `alepha dev` and look for the gear button in the bottom-left corner of your app. The UI is also directly reachable at `/__devtools/`.

## What You Get

The devtools UI inspects the live Alepha container behind your dev server: registered services and primitives, configuration atoms, database records, logs, and the dependency graph.

## Configuration

`devtools()` accepts:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `hideButton` | `boolean` | `false` | Hide the floating button. The UI stays reachable at `/__devtools/` |

```typescript
devtools({ hideButton: true })
```

## Dev-Only by Design

The plugin only attaches to the Vite dev server — nothing devtools-related ships in your production build, and `@alepha/devtools` belongs in `devDependencies`.

If the config references `devtools()` but the package isn't installed, the plugin degrades to a no-op with a warning instead of breaking config load — so removing the dependency without touching `alepha.config.ts` is safe.
