# React Tests

Alepha provides testing utilities for React components through `alepha/react/testing`. Browser tests run in jsdom via Vitest and use `@testing-library/react` under the hood.

## File Naming Convention

Browser test files use the `.browser.spec.ts` or `.browser.spec.tsx` extension. Configure a Vitest project in your `vitest.config.ts` that routes these files to the jsdom environment:

```typescript
projects: [
  {
    test: {
      include: ["src/**/*.browser.spec.{ts,tsx}"],
      environment: "jsdom",
    },
  },
]
```

```
src/
  web/
    components/
      LoginForm.tsx
      LoginForm.browser.spec.tsx   # Runs in jsdom
```

## Utilities

The `alepha/react/testing` module exports:

| Function | Purpose |
|----------|---------|
| `renderWithAlepha(element, options?)` | Async render with Alepha context (auto-starts the instance) |
| `renderWithAlephaSync(element, options?)` | Sync render (autoStart defaults to false) |
| `fillForm(screen, formId, values)` | Fill form fields by test ID (`{formId}-{fieldName}`) |
| `fillField(screen, testId, value)` | Fill a single field by its test ID |
| `submitForm(screen, options?)` | Click the submit button (default text: "Submit") |
| `resetForm(screen, buttonText?)` | Click the reset button (default text: "Reset") |
| `waitForFormSubmit(alepha, formId)` | Wait for the `form:submit:end` event |
| `toggleSwitch(screen, role?, name?)` | Toggle a switch or checkbox element |
| `setupJsdomMocks()` | Mock `matchMedia`, `ResizeObserver`, `IntersectionObserver`, `scrollTo`, `getComputedStyle` |

## Basic Rendering

```typescript
import { renderWithAlepha, setupJsdomMocks } from "alepha/react/testing";

beforeAll(() => setupJsdomMocks());

test("should render greeting", async () => {
  const { getByText, alepha } = await renderWithAlepha(<Greeting name="Alice" />);

  expect(getByText("Hello, Alice")).toBeDefined();
});
```

`renderWithAlepha` creates an Alepha instance, starts it, and wraps the component in `AlephaContext.Provider`. It returns the standard `@testing-library/react` render result plus the `alepha` instance.

## Custom Alepha Configuration

Pass a pre-configured Alepha instance to swap services or providers:

```typescript
import { renderWithAlepha } from "alepha/react/testing";

test("should render with mocked service", async () => {
  const alepha = Alepha.create().with({ provide: UserService, use: FakeUserService });

  const { getByText } = await renderWithAlepha(<UserProfile />, { alepha });

  expect(getByText("Fake User")).toBeDefined();
});
```

## Wrapper Components

Use the `wrapper` option to add UI framework providers (theme, i18n):

```typescript
import { renderWithAlepha } from "alepha/react/testing";
import { ThemeProvider } from "my-ui-library";

test("should render themed component", async () => {
  const { getByRole } = await renderWithAlepha(
    <Button>Click me</Button>,
    { wrapper: ThemeProvider },
  );

  expect(getByRole("button")).toBeDefined();
});
```

## Form Testing

Form helpers find inputs by test IDs constructed as `{formId}-{fieldName}`.

```typescript
import {
  renderWithAlepha,
  fillForm,
  submitForm,
  waitForFormSubmit,
  setupJsdomMocks,
} from "alepha/react/testing";
import { screen } from "@testing-library/react";

beforeAll(() => setupJsdomMocks());

test("should submit login form", async () => {
  const { alepha } = await renderWithAlepha(<LoginForm />);

  await fillForm(screen, "login-form", {
    email: "alice@example.com",
    password: "secret123",
  });

  await submitForm(screen, { submitButtonText: "Login" });

  // Optionally wait for submission to complete
  await waitForFormSubmit(alepha, "login-form");
});
```

### Nested Fields

For nested form fields, use dot notation in the field name:

```typescript
await fillForm(screen, "address-form", {
  "address.city": "New York",
  "address.zip": "10001",
});
```

### Checkboxes and Switches

`fillForm` automatically detects checkbox and switch inputs. Pass `true` or `false` as the value:

```typescript
await fillForm(screen, "settings-form", {
  notifications: true,
  darkMode: false,
});
```

You can also toggle switches directly:

```typescript
import { toggleSwitch } from "alepha/react/testing";

await toggleSwitch(screen, "switch", "Enable notifications");
```

## jsdom Mocks

Call `setupJsdomMocks()` in `beforeAll` to mock browser APIs that jsdom does not implement. This is required for components that use responsive styles, scroll behavior, or intersection observers.

```typescript
import { setupJsdomMocks } from "alepha/react/testing";

beforeAll(() => {
  setupJsdomMocks();
});
```

Mocked APIs:
- `window.matchMedia`
- `window.ResizeObserver`
- `window.IntersectionObserver`
- `window.scrollTo`
- `window.getComputedStyle`
