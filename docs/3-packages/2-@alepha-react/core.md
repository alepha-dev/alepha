# @alepha/react - Core

React components and hooks for building Alepha applications.

## Installation

```bash
npm install @alepha/react
```

## Overview

Provides full-stack React development with declarative routing, server-side rendering, and client-side hydration.

The React module enables building modern React applications using the `$page` primitive on class properties.
It delivers seamless server-side rendering, automatic code splitting, and client-side navigation with full
type safety and schema validation for route parameters and data.

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
