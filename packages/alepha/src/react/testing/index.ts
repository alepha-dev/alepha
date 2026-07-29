import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./form.ts";
export * from "./render.tsx";
export * from "./setup.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Testing utilities for Alepha React applications.
 *
 * **Features:**
 * - `renderWithAlepha()` - Render components with Alepha context
 * - `fillForm()` / `submitForm()` - Form testing helpers
 * - `setupJsdomMocks()` - Mock browser APIs for jsdom
 *
 * @module alepha.react.testing
 *
 * @example
 * ```tsx
 * import { renderWithAlepha, fillForm, submitForm, setupJsdomMocks } from "alepha/react/testing";
 *
 * // Setup mocks before tests
 * beforeAll(() => {
 *   setupJsdomMocks();
 * });
 *
 * test("form submission", async () => {
 *   const { alepha } = await renderWithAlepha(<MyForm />);
 *   // `screen` comes from @testing-library/react
 *
 *   // Fill form fields by their schema keys
 *   await fillForm(screen, "my-form", { name: "Alice", age: 30 });
 *
 *   // Submit and wait for handler
 *   await submitForm(screen);
 * });
 * ```
 */
export const AlephaReactTesting = $module({
  name: "alepha.react.testing",
});
