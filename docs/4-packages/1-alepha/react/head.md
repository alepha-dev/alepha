# Alepha - React Head

## Installation

Part of the `alepha` package. Import from `alepha/react/head`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.4.0 | node, bun, browser|

HTML head element management.

**Features:**
- Title, meta tags, and links
- SEO optimization
- Social media tags

## API Reference

### Primitives

- [`$head`](/docs/primitives-$head) — Set global `<head>` options for the application.

### Hooks

- [`useHead`](/docs/primitives-usehead) — ```tsx

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### BrowserHeadProvider

Browser-side head provider that manages document head elements.

Used by ReactBrowserProvider and ReactBrowserRouterProvider to update
document title, meta tags, and other head elements during client-side
navigation.

#### HeadProvider

Provides methods to fill and merge head information into the application state.

Used both on server and client side to manage document head.

#### ServerHeadProvider

Server-side head provider that fills head content from route configurations.

Used by ReactServerProvider to collect title, meta tags, and other head
elements which are then rendered by ReactServerTemplateProvider.
