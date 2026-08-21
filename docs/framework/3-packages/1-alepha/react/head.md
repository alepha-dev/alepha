# Alepha - React Head

## Installation

Part of the `alepha` package. Import from `alepha/react/head`.

```bash
npm install alepha
```

## Overview

HTML head element management.

**Features:**

- Title, meta tags, and links
- SEO optimization
- Social media tags

## API Reference

### Primitives

- [`$head`](/docs/reference-primitives-$head) - Set global `<head>` options for the application.

### React Hooks

- [`useHead`](/docs/reference-react-hooks-usehead) - Read and update the document head (title, meta, …) from a component.

### Providers

- [`BrowserHeadProvider`](/docs/reference-providers-browserheadprovider) - Browser-side head provider that manages document head elements.
- [`HeadProvider`](/docs/reference-providers-headprovider) - Provides methods to fill and merge head information into the application state.
- [`ServerHeadProvider`](/docs/reference-providers-serverheadprovider) - Server-side head provider that fills head content from route configurations.
