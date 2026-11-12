# React Tests

Alepha provides testing utilities for React components through `alepha/testing/react`. Browser tests run in jsdom via Vitest and use `@testing-library/react` under the hood.

## Setup

Vitest ships with `alepha`, but jsdom and Testing Library do not. Install them in the project:

```bash
npm install -D jsdom @testing-library/react @testing-library/dom axe-core
```

`axe-core` is needed by `expectAccessible` only, and is loaded when it is called: leave it out if you do not use it.

## File Naming Convention

Browser test files use the `.browser.spec.ts` or `.browser.spec.tsx` extension. Route them to jsdom with `jsdomProject` from `alepha/testing/vitest`, in the `test` block of your `vite.config.ts`, beside a node project that excludes them:

```typescript check
import { jsdomProject } from "alepha/testing/vitest";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: ".",
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          exclude: ["**/node_modules/**", "**/*.browser.spec.{ts,tsx}"],
        },
      },
      jsdomProject(["src/**/*.browser.spec.{ts,tsx}"]),
    ],
  },
});
```

`jsdomProject` carries every setting a jsdom project needs to agree on: the environment, the browser resolve conditions (so a package's `browser` entry is picked), a Node flag that lets jsdom install its own `localStorage`, and a setup file polyfilling `matchMedia`. A config contributes only its `include`.

```txt
src/
  web/
    components/
      LoginForm.tsx
      LoginForm.browser.spec.tsx   # Runs in jsdom
```

## Utilities

The `alepha/testing/react` module exports:

| Function                                  | Purpose                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `renderWithAlepha(element, options?)`     | Async render with Alepha context (auto-starts the instance)                                 |
| `renderWithAlephaSync(element, options?)` | Sync render (autoStart defaults to false)                                                   |
| `fillForm(screen, formId, values)`        | Fill form fields by test ID (`{formId}-{fieldName}`)                                        |
| `fillField(screen, testId, value)`        | Fill a single field by its test ID                                                          |
| `submitForm(screen, options?)`            | Click the submit button (default text: "Submit")                                            |
| `resetForm(screen, buttonText?)`          | Click the reset button (default text: "Reset")                                              |
| `waitForFormSubmit(alepha, formId)`       | Wait for the `form:submit:end` event                                                        |
| `toggleSwitch(screen, role?, name?)`      | Toggle a switch or checkbox element                                                         |
| `setupJsdomMocks()`                       | Mock `matchMedia`, `ResizeObserver`, `IntersectionObserver`, `scrollTo`, `getComputedStyle` |
| `expectAccessible(target?, options?)`     | Run axe on the rendered tree and fail on any WCAG 2.2 A or AA violation                     |

## Basic Rendering

```tsx
import { renderWithAlepha, setupJsdomMocks } from "alepha/testing/react";

beforeAll(() => setupJsdomMocks());

describe("Greeting", () => {
  it("should render greeting", async () => {
    const { getByText, alepha } = await renderWithAlepha(
      <Greeting name="Alice" />,
    );

    expect(getByText("Hello, Alice")).toBeDefined();
  });
});
```

`renderWithAlepha` creates an Alepha instance (`Alepha.create().with(AlephaLogger)`), starts it, and wraps the component in `AlephaContext.Provider`. It returns the standard `@testing-library/react` render result plus the `alepha` instance. Its options are the `@testing-library/react` render options plus `alepha` (a pre-configured instance), `autoStart` (default `true`; `false` for `renderWithAlephaSync`) and `wrapper`.

## Custom Alepha Configuration

Pass a pre-configured Alepha instance to swap services or providers:

```tsx
import { Alepha } from "alepha";
import { renderWithAlepha } from "alepha/testing/react";

describe("UserProfile", () => {
  it("should render with a substituted service", async () => {
    const alepha = Alepha.create().with({
      provide: UserService,
      use: FakeUserService,
    });

    const { getByText } = await renderWithAlepha(<UserProfile />, { alepha });

    expect(getByText("Fake User")).toBeDefined();
  });
});
```

## Wrapper Components

Use the `wrapper` option to add UI framework providers (theme, i18n):

```tsx
import { renderWithAlepha } from "alepha/testing/react";
import { ThemeProvider } from "my-ui-library";

describe("Button", () => {
  it("should render themed component", async () => {
    const { getByRole } = await renderWithAlepha(<Button>Click me</Button>, {
      wrapper: ThemeProvider,
    });

    expect(getByRole("button")).toBeDefined();
  });
});
```

## Form Testing

Form helpers find inputs by test IDs constructed as `{formId}-{fieldName}`. `useForm` sets both the `id` and the `data-testid` of each field to that value, so pass the form an explicit `id` (`useForm({ id: "login-form", ... })`); without one the prefix is a generated `useId()` value. See [Forms](/docs/guides-frontend-forms) for `useForm` itself.

- `fillForm` and `fillField` set `<input>`, `<textarea>` and `<select>` values. `fillForm` accepts a fourth `{ timeout }` argument (default 1000 ms) for fields that appear late.
- `submitForm` only clicks the button whose text is `submitButtonText`. It does not wait for the submission: pair it with `waitForFormSubmit(alepha, formId)`, which resolves on the form's `form:submit:end` event and takes a timeout as its third argument (default 5000 ms). Start waiting before the click, so a fast submission cannot end before anyone listens.

```tsx
import { screen } from "@testing-library/react";
import {
  renderWithAlepha,
  fillForm,
  submitForm,
  waitForFormSubmit,
  setupJsdomMocks,
} from "alepha/testing/react";

beforeAll(() => setupJsdomMocks());

describe("LoginForm", () => {
  it("should submit login form", async () => {
    const { alepha } = await renderWithAlepha(<LoginForm />);

    await fillForm(screen, "login-form", {
      email: "alice@example.com",
      password: "secret123",
    });

    const submitted = waitForFormSubmit(alepha, "login-form");
    await submitForm(screen, { submitButtonText: "Login" });
    await submitted;
  });
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
import { toggleSwitch } from "alepha/testing/react";

await toggleSwitch(screen, "switch", "Enable notifications");
```

## jsdom Mocks

Call `setupJsdomMocks()` in `beforeAll` to mock browser APIs that jsdom does not implement. This is required for components that use responsive styles, scroll behavior, or intersection observers. Each mock is installed only when the global is missing, so it is safe beside `jsdomProject`, whose setup file already provides `matchMedia`.

```typescript
import { setupJsdomMocks } from "alepha/testing/react";

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

## Accessibility

`expectAccessible()` runs [axe](https://github.com/dequelabs/axe-core) with the WCAG 2.0, 2.1 and 2.2 A and AA rules and fails with every violation it finds: for each one, the rule id, its help URL, and the selector and HTML of each node.

```tsx
import { expectAccessible, renderWithAlepha } from "alepha/testing/react";

it("is accessible with the dialog open", async () => {
  await renderWithAlepha(<MyDialog defaultOpen />);
  await expectAccessible();
});
```

- It scans `document.body` by default, not the render container: a dialog, a menu or a popover is portalled outside the container. Pass an element to scan only that.
- `{ disable: ["rule-id"] }` switches a rule off for that one call. There is no global switch: disable a false positive where it is, with the reason beside it.

What it does not prove. Under jsdom no stylesheet is applied and nothing is laid out, so axe sees structure only: names, roles, aria wiring, labels, duplicate ids. `color-contrast` and `target-size` are switched off, since they would return no result and read as a pass. Measure them in a real browser with `expectPageAccessible` (see [End-to-End Tests](/docs/guides-testing-e2e-tests)). And axe finds roughly half of real accessibility issues by its own figure: a green scan is a floor, not a verdict.

## Server-side rendering

`ReactServerProvider.render()` is a supported test API. It renders a registered
page through the production streaming path and collects the HTML for assertions.
It does not require a browser. The default result is page markup; `{ html: true }`
includes the document wrapper, and `{ hydration: false }` omits hydration data.

```typescript check
import { Alepha } from "alepha";
import { $page, ReactServerProvider } from "alepha/react/router";
import { describe, it } from "vitest";

class TestPages {
  home = $page({ path: "/", component: () => "Hello from SSR" });
}

describe("the home page", () => {
  it("renders on the server", async ({ expect }) => {
    const alepha = Alepha.create({ env: { SERVER_PORT: 0 } }).with(TestPages);
    await alepha.start();
    const result = await alepha.inject(ReactServerProvider).render("home");
    expect(result.html).toContain("Hello from SSR");
  });
});
```
