import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

export { default as FormState } from "./components/FormState.tsx";
export * from "./errors/FormValidationError.ts";
export * from "./hooks/useForm.ts";
export * from "./hooks/useFormState.ts";
export * from "./services/FormModel.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface Hooks {
    "form:change": { id: string; path: string; value: any };
    "form:reset": { id: string; values: Record<string, any> };
    "form:submit:begin": { id: string };
    "form:submit:success": { id: string; values: Record<string, any> };
    "form:submit:error": { id: string; error: Error };
    "form:submit:end": { id: string };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Type-safe forms with validation.
 *
 * **Features:**
 * - Form state management
 * - TypeBox schema validation
 * - Field-level error handling
 * - Submit handling with loading state
 * - Form reset
 *
 * @module alepha.react.form
 */
export const AlephaReactForm = $module({
  name: "alepha.react.form",
});
