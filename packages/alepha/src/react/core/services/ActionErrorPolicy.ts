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
 * - **The error says it is shown in place** (`shownInPlace: true`). A
 *   `FormValidationError` naming a field does: the form renders it under
 *   that field.
 *
 * Static rather than a service: hooks call it during a render, on a container
 * that may already be started, where injecting a service it never registered
 * would throw.
 */
export class ActionErrorPolicy {
  public static isHandled(error: unknown, onError?: unknown): boolean {
    if (onError !== undefined) {
      return true;
    }
    return (
      typeof error === "object" &&
      error !== null &&
      (error as { shownInPlace?: unknown }).shownInPlace === true
    );
  }
}
