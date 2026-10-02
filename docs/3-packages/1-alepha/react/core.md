# Alepha - React

## Installation

Part of the `alepha` package. Import from `alepha/react`.

```bash
npm install alepha
```

## Overview

Full-stack React framework with server-side rendering.

**Features:**

- React page routes with type-safe params
- Async action handler with loading/error/cancel states
- Type-safe HTTP client access
- Dependency injection in components
- Global state management
- Router navigation methods
- Current route state access
- Check if path is active
- URL query parameters
- Access route schema
- Subscribe to Alepha events
- Type-safe form handling with validation
- Error handling wrapper component
- Client-side only rendering component
- Server-side rendering with hydration
- Automatic code splitting
- Event system for action tracking

## API Reference

### React Hooks

- [`useAction`](/docs/reference-react-hooks-useaction) - Hook for handling async actions with automatic error handling and event emission.
- [`useAlepha`](/docs/reference-react-hooks-usealepha) - Main Alepha hook.
- [`useClient`](/docs/reference-react-hooks-useclient) - Hook to get a virtual client for the specified scope.
- [`useEvents`](/docs/reference-react-hooks-useevents) - Allow subscribing to multiple Alepha events. See `Hooks` for available events.
- [`useInject`](/docs/reference-react-hooks-useinject) - Hook to inject a service instance.
- [`useQuery`](/docs/reference-react-hooks-usequery) - Hook for declarative data fetching with automatic execution and refetch.
- [`useQueryClient`](/docs/reference-react-hooks-usequeryclient) - Imperative access to the query cache used by `useQuery`.
