# @alepha/react - Head

## Installation

This module is part of the Alepha framework:

```bash
npm install @alepha/react
```

## Overview

Fill `<head>` server & client side.

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

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
