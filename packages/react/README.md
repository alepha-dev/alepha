# Alepha React

Build server-side rendered (SSR) or single-page React applications.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Provides full-stack React development with declarative routing, server-side rendering, and client-side hydration.

The React module enables building modern React applications using the `$page` descriptor on class properties.
It delivers seamless server-side rendering, automatic code splitting, and client-side navigation with full
type safety and schema validation for route parameters and data.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaReact } from "alepha/react";

const alepha = Alepha.create()
	.with(AlephaReact);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with `$` and return configured descriptor instances.

For more details, see the [Descriptors documentation](https://feunard.github.io/alepha/docs/descriptors).

#### $page()

Main descriptor for defining a React route in the application.

### Hooks

Hooks provide a way to tap into various lifecycle events and extend functionality. They follow the convention of starting with `use` and return configured hook instances.

#### useAlepha()

Main Alepha hook.

It provides access to the Alepha instance within a React component.

With Alepha, you can access the core functionalities of the framework:

- alepha.state() for state management
- alepha.inject() for dependency injection
- alepha.emit() for event handling
etc...

#### useClient()

Hook to get a virtual client for the specified scope.

It's the React-hook version of `$client()`, from `AlephaServerLinks` module.

#### useInject()

Hook to inject a service instance.
It's a wrapper of `useAlepha().inject(service)` with a memoization.

#### useQueryParams()

Not well tested. Use with caution.

#### useRouter()

Use this hook to access the React Router instance.

You can add a type parameter to specify the type of your application.
This will allow you to use the router in a typesafe way.

class App {
  home = $page();
}

const router = useRouter<App>();
router.go("home"); // typesafe

#### useRouterEvents()

Subscribe to various router events.

#### useStore()

Hook to access and mutate the Alepha state.
