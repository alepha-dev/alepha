import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

export { default as FormState } from "./components/FormState.tsx";
export * from "./errors/FormValidationError.ts";
export * from "./hooks/useFieldValue.ts";
export * from "./hooks/useForm.ts";
export * from "./hooks/useFormQuerySync.ts";
export * from "./hooks/useFormState.ts";
export * from "./hooks/useFormValues.ts";
export * from "./services/FormModel.ts";
export * from "./services/parseField.ts";
export * from "./services/prettyName.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface Hooks {
    "form:change": {
      id: string;
      path: string;
      value: any;
      /**
       * Programmatic reset (e.g. `setInitialValues` after the parent updates
       * its state). Subscribers tracking dirty state should ignore these.
       */
      initial?: boolean;
    };
    "form:submit:begin": { id: string };
    "form:submit:success": { id: string; values: Record<string, any> };
    "form:submit:error": { id: string; error: Error };
    "form:submit:end": { id: string };
    "form:reset": { id: string };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Type-safe forms with validation.
 *
 * **Features:**
 * - Form state management
 * - Zod schema validation
 * - Field-level error handling
 * - Submit handling with loading state
 * - Form reset
 *
 * @module alepha.react.form
 */
export const AlephaReactForm = $module({
  name: "alepha.react.form",
});
