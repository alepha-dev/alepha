import type { DesktopStartResult } from "../../core/DesktopSupervisor.ts";
import type { DesktopShellMessage } from "../../core/schemas/desktopShellMessageSchema.ts";

/**
 * The `init` the shell sends the server Worker, without its envelope.
 */
export type DesktopInit = Omit<
  Extract<DesktopShellMessage, { type: "init" }>,
  "type" | "version"
>;

/**
 * How the server ended, as the shell learns it after the window loop
 * returns.
 */
export type DesktopShutdown =
  | { kind: "stopped"; graceful: boolean; message?: string }
  | { kind: "crashed"; message: string };

/**
 * The shell's view of the supervisor: the thread that owns the server Worker
 * and can unblock the window loop when the server dies.
 */
export abstract class SupervisorProvider {
  /**
   * Start the server Worker at `workerUrl` and wait for it to be ready,
   * within the readiness deadline.
   */
  public abstract start(
    init: DesktopInit,
    workerUrl: string,
  ): Promise<DesktopStartResult>;

  /**
   * Hand over the window loop's handle: a crash from now on terminates it.
   */
  public abstract attachWindow(handle: number): void;

  /**
   * After the window loop returned: stop the server (within the stop
   * deadline), or report the crash that ended the loop.
   */
  public abstract stop(): Promise<DesktopShutdown>;
}
