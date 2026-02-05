# Alepha - React Testing

## Installation

Part of the `alepha` package. Import from `alepha/react/testing`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 2 - experimental | 0.17.0 | node, bun |

Testing utilities for Alepha React applications.

**Features:**
- `renderWithAlepha()` - Render components with Alepha context
- `fillForm()` / `submitForm()` - Form testing helpers
- `setupJsdomMocks()` - Mock browser APIs for jsdom


```tsx
import { renderWithAlepha, fillForm, submitForm, setupJsdomMocks } from "alepha/react/testing";

// Setup mocks before tests
beforeAll(() => {
  setupJsdomMocks();
});

test("form submission", async () => {
  const { alepha, screen } = renderWithAlepha(<MyForm />);

  // Fill form fields by their schema keys
  await fillForm(screen, "my-form", { name: "Alice", age: 30 });

  // Submit and wait for handler
  await submitForm(screen);
});
```

