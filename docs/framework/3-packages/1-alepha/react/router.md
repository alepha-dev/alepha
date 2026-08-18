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

- [`$page`](/docs/reference-primitives-$page) — Main primitive for defining a React route in the application.

### React Hooks

- [`useActive`](/docs/reference-react-hooks-useactive) — Hook to determine if a given route is active and to provide anchor props for navigation.
- [`useQueryParams`](/docs/reference-react-hooks-usequeryparams) — Hook to manage query parameters in the URL using a defined schema.
- [`useRouter`](/docs/reference-react-hooks-userouter) — Use this hook to access the React Router instance.

### Providers

- [`ReactBrowserRendererProvider`](/docs/reference-providers-reactbrowserrendererprovider) — Browser specific React renderer (react-dom/client interface)
- [`ReactBrowserRouterProvider`](/docs/reference-providers-reactbrowserrouterprovider) — Implementation of AlephaRouter for React in browser environment.
- [`ReactDomServerProvider`](/docs/reference-providers-reactdomserverprovider) — The renderer half of React, loaded only once something actually renders.
- [`ReactPageProvider`](/docs/reference-providers-reactpageprovider) — Handle page routes for React applications. (Browser and Server)
- [`ReactPreloadProvider`](/docs/reference-providers-reactpreloadprovider) — Adds HTTP Link headers for preloading entry assets.
- [`ReactServerProvider`](/docs/reference-providers-reactserverprovider) — React server provider responsible for SSR and static file serving.
- [`ReactServerTemplateProvider`](/docs/reference-providers-reactservertemplateprovider) — Handles HTML streaming for SSR.
- [`RootComponentsProvider`](/docs/reference-providers-rootcomponentsprovider) — Extension point letting any module contribute root-level React nodes that
- [`RouterLocaleProvider`](/docs/reference-providers-routerlocaleprovider) — Generic locale path-prefix mechanism for the router.
- [`SSRManifestProvider`](/docs/reference-providers-ssrmanifestprovider) — Provider for SSR manifest data used for module preloading.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `REACT_SSR_ENABLED` | boolean | - | Enable or disable server-side rendering (SSR) for React pages. When set to false, pages are rendered client-side only. |
