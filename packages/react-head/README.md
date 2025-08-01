# Alepha React Head

Manages the document <head> for SEO and metadata.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/react-head
```

## Module

Fill `<head>` server & client side.

## API Reference

### Descriptors

#### $head()

Set global `<head>` options for the application.

### Hooks

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
