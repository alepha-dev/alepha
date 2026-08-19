# Alepha - React Ui

## Installation

Part of the `alepha` package. Import from `alepha/react/ui`.

```bash
npm install alepha
```

## Overview

Persisted UI state: color mode, theme palette, sidebar collapsed state.

Backed by an `alepha-ui` cookie so preferences survive reloads and are
available during SSR (no flash of wrong theme).

## API Reference

### React Hooks

- [`useColorMode`](/docs/reference-react-hooks-usecolormode) - Read and update the user's color-mode preference. `"system"` resolves to
- [`useSidebarState`](/docs/reference-react-hooks-usesidebarstate) - Read and update the sidebar collapsed state. The value is persisted via the
- [`useTheme`](/docs/reference-react-hooks-usetheme) - Read and update the active theme palette name. UI consumers typically map
