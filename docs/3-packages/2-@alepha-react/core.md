# @alepha/react - Core

React components and hooks for building Alepha applications.

## Installation

```bash
npm install @alepha/react
```

## Overview

| type | quality | stability |
|------|---------|-----------|
| frontend | epic | stable |

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

Hooks provide a way to tap into various lifecycle events and extend functionality. They follow the convention of starting with `use` and return configured hook instances.

#### useAlepha()

Main Alepha hook.

It provides access to the Alepha instance within a React component.

With Alepha, you can access the core functionalities of the framework:

- alepha.state() for state management
- alepha.inject() for dependency injection
- alepha.events.emit() for event handling
etc...

#### useClient()

Hook to get a virtual client for the specified scope.

It's the React-hook version of `$client()`, from `AlephaServerLinks` module.

#### useEvents()

Allow subscribing to multiple Alepha events. See {@link Hooks} for available events.

useEvents is fully typed to ensure correct event callback signatures.

```tsx
useEvents(
  {
    "react:transition:begin": (ev) => {
      console.log("Transition began to:", ev.to);
    },
    "react:transition:error": {
      priority: "first",
      callback: (ev) => {
        console.error("Transition error:", ev.error);
      },
    },
  },
  [],
);
```

#### useInject()

Hook to inject a service instance.
It's a wrapper of `useAlepha().inject(service)` with a memoization.
