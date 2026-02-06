# Alepha - React Router

## Installation

Part of the `alepha` package. Import from `alepha/react/router`.

```bash
npm install alepha
```

## Overview

Provides declarative routing with the `$page` primitive for building type-safe React routes.

This module enables:
- URL pattern matching with parameters (e.g., `/users/:id`)
- Nested routing with parent-child relationships
- Type-safe URL parameter and query string validation
- Server-side data fetching with the `loader` function
- Lazy loading and code splitting
- Page animations and error handling

## API Reference

### Primitives

- [`$page`](/docs/primitives-$page) — Main primitive for defining a React route in the application.

### Hooks

- [`useActive`](/docs/primitives-useactive) — Hook to determine if a given route is active and to provide anchor props for navigation.
- [`useQueryParams`](/docs/primitives-usequeryparams) — Hook to manage query parameters in the URL using a defined schema.
- [`useRouter`](/docs/primitives-userouter) — Use this hook to access the React Router instance.

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### ReactBrowserRendererProvider

Browser specific React renderer (react-dom/client interface)

#### ReactBrowserRouterProvider

Implementation of AlephaRouter for React in browser environment.

#### ReactPageProvider

Handle page routes for React applications. (Browser and Server)

#### ReactPreloadProvider

Adds HTTP Link headers for preloading entry assets.

Benefits:
- Early Hints (103): Servers can send preload hints before the full response
- CDN optimization: Many CDNs use Link headers to optimize asset delivery
- Browser prefetching: Browsers can start fetching resources earlier

The Link header is computed once at first request and cached for reuse.

#### ReactServerProvider

React server provider responsible for SSR and static file serving.

Coordinates between:
- ReactPageProvider: Page routing and layer resolution
- ReactServerTemplateProvider: HTML template parsing and streaming
- ServerHeadProvider: Head content management
- SSRManifestProvider: Module preload link collection

Uses `react-dom/server` under the hood.

#### ReactServerTemplateProvider

Handles HTML streaming for SSR.

Uses hardcoded HTML structure - all customization via $head primitive.
Pre-encodes static parts as Uint8Array for zero-copy streaming.

#### SSRManifestProvider

Provider for SSR manifest data used for module preloading.

The manifest is populated at build time by embedding data into the
generated index.js via the ssrManifestAtom. This eliminates filesystem
reads at runtime, making it optimal for serverless deployments.

Manifest files are generated during `vite build`:
- manifest.json (client manifest)
- preload-manifest.json (from viteAlephaSsrPreload plugin)

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `REACT_SSR_ENABLED` | boolean | - |  |
| `REACT_STRICT_MODE` | boolean | true |  |
