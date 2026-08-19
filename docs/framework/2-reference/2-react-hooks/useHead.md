# useHead

## Import

```typescript
import { useHead } from "alepha/react/head";
```

## Overview

Read and update the document head (title, meta, …) from a component.

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

