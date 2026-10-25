import { SchemaValidationError } from "alepha";

/**
 * A form refusal to show under a field: a `SchemaValidationError` whose
 * `data.path` names the field (`"/email"`), or `""` for the whole form.
 *
 * `useFormState` pins it under that field, and `ActionErrorPolicy` treats one
 * naming a field as handled, so a mounted `ActionErrorToaster` does not toast
 * it on top.
 *
 * ```ts
 * throw new FormValidationError({ message: "Email already in use", path: "/email" });
 * ```
 */
export const FormValidationError = SchemaValidationError.extend({
  name: "FORM_VALIDATION",
  message: (data) => data.message,
});

export type FormValidationError = InstanceType<typeof FormValidationError>;
