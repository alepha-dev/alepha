# @alepha/react - Head

## Installation

```bash
npm install @alepha/react
```

## Overview

Fill `<head>` server & client side.

Generate SEO-friendly meta tags and titles for your React application using AlephaReactHead module.

This module provides services and primitives to manage the document head both on the server and client side,
ensuring that your application is optimized for search engines and social media sharing.

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $head()

Set global `<head>` options for the application.

### Hooks

Hooks provide a way to tap into various lifecycle events and extend functionality. They follow the convention of starting with `use` and return configured hook instances.

#### useHead()

```tsx
const App = () => {
  const [head, setHead] = useHead({
    // will set the document title on the first render
    title: "My App",
  });

  return (
    // This will update the document title when the button is clicked
    <button onClick={() => setHead({ title: "Change Title" })}>
      Change Title {head.title}
    </button>
  );
}
```

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### BrowserHeadProvider

Browser-side head provider that manages document head elements.

Used by ReactBrowserProvider and ReactBrowserRouterProvider to update
document title, meta tags, and other head elements during client-side
navigation.

#### HeadProvider

Provides methods to fill and merge head information into the application state.

Used both on server and client side to manage document head.

#### ServerHeadProvider

Server-side head provider that fills head content from route configurations.

Used by ReactServerProvider to collect title, meta tags, and other head
elements which are then rendered by ReactServerTemplateProvider.
