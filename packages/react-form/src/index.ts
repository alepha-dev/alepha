import { $module } from "@alepha/core";

// ---------------------------------------------------------------------------------------------------------------------

export { default as FormState } from "./components/FormState.tsx";
export * from "./hooks/useForm.ts";
export * from "./hooks/useFormState.ts";
export * from "./services/FormModel.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "@alepha/core" {
  interface Hooks {
    "form:change": { id: string; path: string };
    "form:submit:begin": { id: string };
    "form:submit:success": { id: string };
    "form:submit:error": { id: string; error: Error };
    "form:submit:end": { id: string };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * React hooks for managing forms in Alepha applications.
 *
 * This module provides a set of hooks to simplify form handling, validation, and submission in React applications built with Alepha.
 *
 * It includes:
 * - `useForm`: A hook for managing form state, validation, and submission.
 *
 * @see {@link useForm}
 * @module alepha.react.form
 */
export const AlephaReactForm = $module({
  name: "alepha.react.form",
});
