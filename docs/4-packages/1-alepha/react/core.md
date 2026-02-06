# Alepha - React

## Installation

Part of the `alepha` package. Import from `alepha/react`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.2.0 | node, bun, workerd, browser, expo|

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

### Hooks

- [`useAction`](/docs/primitives-useaction) — Hook for handling async actions with automatic error handling and event emission.
- [`useAlepha`](/docs/primitives-usealepha) — Main Alepha hook.
- [`useClient`](/docs/primitives-useclient) — Hook to get a virtual client for the specified scope.
- [`useEvents`](/docs/primitives-useevents) — Allow subscribing to multiple Alepha events. See {@link Hooks} for available events.
- [`useInject`](/docs/primitives-useinject) — Hook to inject a service instance.
