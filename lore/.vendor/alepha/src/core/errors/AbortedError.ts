import { $error } from "../primitives/$error.ts";

/**
 * The reason the framework gives every signal it aborts: a client that
 * disconnected, a job that was cancelled, an app that is stopping.
 *
 * Its message names who aborted, so a debug line can say why the work
 * stopped. It is an outcome, not a failure: `alepha.context.isAbortError`
 * recognises it, and nothing reports it as an error.
 *
 * ```ts
 * controller.abort(new AbortedError("Client disconnected"));
 * ```
 */
export const AbortedError = $error({
  name: "ABORTED",
  message: "Aborted",
});

export type AbortedError = InstanceType<typeof AbortedError>;
