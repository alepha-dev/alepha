/**
 * Whether a failed action, query, form submit or table read has already been
 * dealt with, which is what `react:action:error`'s `handled` flag says and
 * what a mounted `ActionErrorToaster` reads to stay quiet.
 *
 * One rule for every emitter, so `useAction`, `useQuery`, `FormModel` and
 * the DataTable agree:
 *
 * - **The caller passed an `onError`.** It dealt with the failure, by a toast
 *   of its own or by staying quiet on purpose.
 * - **The error is shown in place**: a `FormValidationError` (name
 *   `FORM_VALIDATION`) whose `data.path` names a field, which the form
 *   renders under that field. Read by name, since this module cannot import
 *   the form's. Or an error `markShownInPlace` was given: `useActionForm`
 *   marks a server `ValidationError` whose every issue landed on a field.
 *
 * Static rather than a service: hooks call it during a render, on a container
 * that may already be started, where injecting a service it never registered
 * would throw.
 */
export class ActionErrorPolicy {
  /**
   * Errors their emitter already shows where they belong.
   */
  protected static readonly shownInPlace = new WeakSet<object>();

  /**
   * Say that `error` is shown in place (under the fields it names), so no
   * emitter reports it as unhandled. Called before the error is rethrown.
   */
  public static markShownInPlace(error: object): void {
    ActionErrorPolicy.shownInPlace.add(error);
  }

  public static isHandled(error: unknown, onError?: unknown): boolean {
    if (onError !== undefined) {
      return true;
    }
    if (
      typeof error === "object" &&
      error !== null &&
      ActionErrorPolicy.shownInPlace.has(error)
    ) {
      return true;
    }
    const candidate = error as {
      name?: unknown;
      data?: { path?: unknown };
    } | null;
    return (
      typeof candidate === "object" &&
      candidate !== null &&
      candidate.name === "FORM_VALIDATION" &&
      typeof candidate.data?.path === "string" &&
      candidate.data.path !== ""
    );
  }
}
