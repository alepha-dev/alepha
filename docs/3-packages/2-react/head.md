# @alepha/react - Head

## Installation

This module is part of the Alepha framework:

```bash
npm install @alepha/react
```

## Overview

Fill `<head>` server & client side.

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
