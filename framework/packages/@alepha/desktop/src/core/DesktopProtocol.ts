import {
  type DesktopShellMessage,
  desktopShellMessageSchema,
} from "./schemas/desktopShellMessageSchema.ts";
import {
  type DesktopWorkerMessage,
  desktopWorkerMessageSchema,
} from "./schemas/desktopWorkerMessageSchema.ts";

/**
 * The contract between the desktop shell and the Worker hosting the app.
 *
 * ```
 * shell                         worker
 *   init { env, capability } ->
 *                            <-  ready { origin }   (or failed)
 *   stop                     ->
 *                            <-  stopped            (or failed)
 * ```
 *
 * Both sides parse what they receive: a message that does not match is a
 * protocol failure, never something to guess at. The deadlines are the
 * shell's: readiness within {@link DesktopProtocol.readyTimeoutMs}, stop
 * within {@link DesktopProtocol.stopTimeoutMs}, after which the Worker is
 * terminated and the exit is a failure, never a graceful one.
 */
export class DesktopProtocol {
  /**
   * The protocol version both sides speak.
   */
  public readonly version = 1;

  /**
   * How long the shell waits for `ready` after `init`.
   */
  public readonly readyTimeoutMs = 30_000;

  /**
   * How long the shell waits for `stopped` after `stop`.
   */
  public readonly stopTimeoutMs = 15_000;

  /**
   * Parse a message received by the Worker, or answer undefined.
   */
  public parseShellMessage(data: unknown): DesktopShellMessage | undefined {
    const result = desktopShellMessageSchema.safeParse(data);
    return result.success ? result.data : undefined;
  }

  /**
   * Parse a message received by the shell, or answer undefined.
   */
  public parseWorkerMessage(data: unknown): DesktopWorkerMessage | undefined {
    const result = desktopWorkerMessageSchema.safeParse(data);
    return result.success ? result.data : undefined;
  }

  /**
   * The message of an error, without its stack or the source excerpt Bun
   * prints around an uncaught throw: what a person may see in a dialog.
   */
  public sanitize(error: unknown): string {
    const raw =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unknown error";
    // Bun's uncaught-error text is the numbered source lines, a caret, then
    // `<Name>: <message>` and the stack: keep the message line alone.
    const message = raw
      .split("\n")
      .map((line) => line.trim().replace(/^error: (?=\d+ \|)/, ""))
      .find(
        (line) =>
          line.length > 0 &&
          !/^\d+ \|/.test(line) &&
          !/^\^+$/.test(line) &&
          !line.startsWith("at "),
      )
      ?.replace(/^(?:[A-Za-z]*Error|error): /, "");
    return (message || "Unknown error").slice(0, 500);
  }
}
