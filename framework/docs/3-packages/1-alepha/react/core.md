# Alepha - React

## Installation

Part of the `alepha` package. Import from `alepha/react`.

```bash
npm install alepha
```

## Overview

The React bindings of an Alepha container: hooks and components that work
with or without the router.

**Features:**

- Async action handler with loading/error/cancel states
- Declarative reads with a keyed cache, invalidation and retries
- Type-safe HTTP client access
- Dependency injection in components
- Global state management
- Subscribe to Alepha events
- Error handling wrapper component
- Client-side only rendering component
- Event system for action tracking

Page routes, navigation and server-side rendering are `alepha/react/router`;
forms are `alepha/react/form`.

## API Reference

### React Hooks

- [`useAction`](/docs/reference-react-hooks-useaction) - Hook for handling async actions with automatic error handling and event emission.
- [`useAlepha`](/docs/reference-react-hooks-usealepha) - Main Alepha hook.
- [`useClient`](/docs/reference-react-hooks-useclient) - Hook to get a virtual client for the specified scope.
- [`useEvents`](/docs/reference-react-hooks-useevents) - Allow subscribing to multiple Alepha events. See `Hooks` for available events.
- [`useInfiniteQuery`](/docs/reference-react-hooks-useinfinitequery) - Hook for a list read page by page, every page loaded so far kept under one
- [`useInject`](/docs/reference-react-hooks-useinject) - Hook to inject a service instance.
- [`useQuery`](/docs/reference-react-hooks-usequery) - Hook for declarative data fetching with automatic execution and refetch.
- [`useQueryClient`](/docs/reference-react-hooks-usequeryclient) - Imperative access to the query cache used by `useQuery`.
