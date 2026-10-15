import { SchemaValidationError } from "alepha";

export class FormValidationError extends SchemaValidationError {
  readonly name = "ValidationError";

  /**
   * Whether the form renders this error in place: true when it names a field,
   * which `useFormState` pins under that field. `ActionErrorPolicy` reads it,
   * so a mounted `ActionErrorToaster` does not toast it on top.
   */
  public get shownInPlace(): boolean {
    return this.value.path !== "";
  }

  constructor(options: { message: string; path: string }) {
    super({
      message: options.message,
      instancePath: options.path,
      params: {},
    });
  }
}
