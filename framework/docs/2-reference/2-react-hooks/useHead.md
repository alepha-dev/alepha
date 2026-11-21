# useHead

## Import

```typescript
import { useHead } from "alepha/react/head";
```

## Overview

Read and update the document head (title, meta, …) from a component.

The SEO fields (`description`, `image`, `url`, ...) expand into their meta
and link tags, as in a page's `head`. The returned head reads the document
when asked: it is not state, and `setHead` does not render the component
again.

```tsx
const App = () => {
  const [, setHead] = useHead({
    // will set the document title on the first render
    title: "My App",
  });

  return (
    // This will update the document title when the button is clicked
    <button onClick={() => setHead({ title: "Change Title" })}>
      Change Title
    </button>
  );
};
```
