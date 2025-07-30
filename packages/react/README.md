# Alepha React

Build server-side rendered (SSR) or single-page React applications.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/react
```

## Module

Provides full-stack React development with declarative routing, server-side rendering, and client-side hydration.

The React module enables building modern React applications using the `$page` descriptor on class properties.
It delivers seamless server-side rendering, automatic code splitting, and client-side navigation with full
type safety and schema validation for route parameters and data.

## API Reference

### Descriptors

#### $page()

Main descriptor for defining a React route in the application.

### Hooks

#### useStore()

Hook to access and mutate the Alepha state.
