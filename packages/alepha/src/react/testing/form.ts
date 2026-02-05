import { fireEvent, type Screen, waitFor } from "@testing-library/react";

/**
 * Options for fillForm helper.
 */
export interface FillFormOptions {
  /**
   * Timeout for waiting for elements to appear.
   * @default 1000
   */
  timeout?: number;
}

/**
 * Fill form fields by their values.
 *
 * This helper finds form inputs by their test IDs (based on form ID and field name)
 * and sets their values using fireEvent.
 *
 * @param screen - The screen object from @testing-library/react
 * @param formId - The form's ID (used to construct test IDs)
 * @param values - Object with field names as keys and values to fill
 * @param options - Fill options
 *
 * @example
 * ```tsx
 * import { fillForm } from "alepha/react/testing";
 *
 * // For a form with id="user-form" and fields: name, email, age
 * await fillForm(screen, "user-form", {
 *   name: "Alice",
 *   email: "alice@example.com",
 *   age: 30,
 * });
 * ```
 *
 * @example
 * ```tsx
 * // For nested fields (e.g., address.city)
 * await fillForm(screen, "user-form", {
 *   "address.city": "New York",
 *   "address.zip": "10001",
 * });
 * ```
 */
export const fillForm = async (
  screen: Screen,
  formId: string,
  values: Record<string, string | number | boolean>,
  options: FillFormOptions = {},
): Promise<void> => {
  const { timeout = 1000 } = options;

  for (const [fieldName, value] of Object.entries(values)) {
    const testId = `${formId}-${fieldName}`;

    await waitFor(
      () => {
        const element = screen.getByTestId(testId);

        if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
          const inputElement = element as
            | HTMLInputElement
            | HTMLTextAreaElement;
          const inputType = inputElement.type?.toLowerCase();

          if (inputType === "checkbox" || inputElement.role === "switch") {
            // For checkboxes and switches, click to toggle
            const currentChecked = (inputElement as HTMLInputElement).checked;
            if (currentChecked !== Boolean(value)) {
              fireEvent.click(inputElement);
            }
          } else {
            // For text inputs, number inputs, etc.
            fireEvent.change(inputElement, {
              target: { value: String(value) },
            });
          }
        } else if (element.tagName === "SELECT") {
          // For select elements
          fireEvent.change(element, { target: { value: String(value) } });
        }
      },
      { timeout },
    );
  }
};

/**
 * Fill a single form field by its test ID.
 *
 * @param screen - The screen object from @testing-library/react
 * @param testId - The element's test ID
 * @param value - The value to set
 *
 * @example
 * ```tsx
 * import { fillField } from "alepha/react/testing";
 *
 * await fillField(screen, "user-form-email", "alice@example.com");
 * ```
 */
export const fillField = async (
  screen: Screen,
  testId: string,
  value: string | number | boolean,
): Promise<void> => {
  const element = screen.getByTestId(testId);

  if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
    const inputElement = element as HTMLInputElement | HTMLTextAreaElement;
    const inputType = inputElement.type?.toLowerCase();

    if (inputType === "checkbox" || inputElement.role === "switch") {
      const currentChecked = (inputElement as HTMLInputElement).checked;
      if (currentChecked !== Boolean(value)) {
        fireEvent.click(inputElement);
      }
    } else {
      fireEvent.change(inputElement, { target: { value: String(value) } });
    }
  } else if (element.tagName === "SELECT") {
    fireEvent.change(element, { target: { value: String(value) } });
  }
};

/**
 * Options for submitForm helper.
 */
export interface SubmitFormOptions {
  /**
   * Text of the submit button to click.
   * @default "Submit"
   */
  submitButtonText?: string;

  /**
   * Timeout for waiting for submission to complete.
   * @default 1000
   */
  timeout?: number;

  /**
   * Whether to wait for a form:submit:success event.
   * @default false
   */
  waitForSuccess?: boolean;
}

/**
 * Submit a form by clicking the submit button.
 *
 * @param screen - The screen object from @testing-library/react
 * @param options - Submit options
 *
 * @example
 * ```tsx
 * import { submitForm } from "alepha/react/testing";
 *
 * // Submit by clicking "Submit" button (default)
 * await submitForm(screen);
 *
 * // Submit by clicking a custom button
 * await submitForm(screen, { submitButtonText: "Save" });
 * ```
 */
export const submitForm = async (
  screen: Screen,
  options: SubmitFormOptions = {},
): Promise<void> => {
  const { submitButtonText = "Submit" } = options;

  const submitButton = screen.getByText(submitButtonText);
  fireEvent.click(submitButton);
};

/**
 * Reset a form by clicking the reset button.
 *
 * @param screen - The screen object from @testing-library/react
 * @param resetButtonText - Text of the reset button
 *
 * @example
 * ```tsx
 * import { resetForm } from "alepha/react/testing";
 *
 * await resetForm(screen); // Clicks "Reset" button
 * await resetForm(screen, "Clear"); // Clicks "Clear" button
 * ```
 */
export const resetForm = async (
  screen: Screen,
  resetButtonText: string = "Reset",
): Promise<void> => {
  const resetButton = screen.getByText(resetButtonText);
  fireEvent.click(resetButton);
};

/**
 * Wait for a form submission to complete by listening for the form:submit:end event.
 *
 * @param alepha - The Alepha instance
 * @param formId - The form's ID
 * @param timeout - Maximum time to wait in ms
 *
 * @example
 * ```tsx
 * import { waitForFormSubmit } from "alepha/react/testing";
 *
 * fireEvent.click(submitButton);
 * await waitForFormSubmit(alepha, "my-form");
 * // Form submission is now complete
 * ```
 */
export const waitForFormSubmit = async (
  alepha: {
    events: {
      once: (event: string, handler: (data: any) => void) => () => void;
    };
  },
  formId: string,
  timeout: number = 5000,
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Form submission timeout after ${timeout}ms`));
    }, timeout);

    alepha.events.once("form:submit:end", (data: { id: string }) => {
      if (data.id === formId) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
};

/**
 * Toggle a switch or checkbox element.
 *
 * @param screen - The screen object from @testing-library/react
 * @param role - The role to find the element by ("switch" or "checkbox")
 * @param name - Optional accessible name to find a specific element
 *
 * @example
 * ```tsx
 * import { toggleSwitch } from "alepha/react/testing";
 *
 * // Toggle the first switch on the page
 * await toggleSwitch(screen, "switch");
 *
 * // Toggle a specific switch by its label
 * await toggleSwitch(screen, "switch", "Enable notifications");
 * ```
 */
export const toggleSwitch = async (
  screen: Screen,
  role: "switch" | "checkbox" = "switch",
  name?: string,
): Promise<void> => {
  const element = name
    ? screen.getByRole(role, { name })
    : screen.getByRole(role);

  fireEvent.click(element);
};
