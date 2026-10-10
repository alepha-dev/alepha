import {
  type DesktopStartResult,
  type DesktopStopResult,
  DesktopSupervisor,
  type DesktopWorkerLike,
} from "../../core/DesktopSupervisor.ts";
import type { DesktopInit } from "../providers/SupervisorProvider.ts";

/**
 * What the shell sends the supervisor Worker.
 */
export type DesktopSupervisorCommand =
  | { type: "start"; init: DesktopInit; workerUrl: string }
  | { type: "window"; handle: number }
  | { type: "stop" };

/**
 * What the supervisor Worker answers the shell.
 */
export type DesktopSupervisorEvent =
  | { type: "started"; result: DesktopStartResult }
  | { type: "crashed"; message: string }
  | { type: "stopped"; result: DesktopStopResult };

/**
 * The supervisor Worker: the thread that owns the server Worker while the
 * main thread is blocked in the window loop.
 *
 * It runs a {@link DesktopSupervisor} over the server Worker. When the server
 * dies after it was ready, it reports `crashed` and terminates the window
 * loop through `terminate(handle)`, which the webview library allows from any
 * thread; the shell then shows the error and exits nonzero. A crash before
 * the window handle arrived terminates the loop as soon as it does.
 */
export class DesktopSupervisorWorker {
  protected readonly scope: {
    postMessage: (event: DesktopSupervisorEvent) => void;
    addEventListener: (
      type: "message",
      listener: (event: { data: any }) => void,
    ) => void;
  };
  protected readonly terminate: (handle: number) => void;
  protected readonly spawn: (url: string) => DesktopWorkerLike;
  protected supervisor?: DesktopSupervisor;
  protected handle?: number;
  protected crashed?: string;

  constructor(
    scope: DesktopSupervisorWorker["scope"],
    terminate: (handle: number) => void,
    spawn: (url: string) => DesktopWorkerLike = (url) =>
      new Worker(url) as unknown as DesktopWorkerLike,
  ) {
    this.scope = scope;
    this.terminate = terminate;
    this.spawn = spawn;
  }

  /**
   * Install the message listener, synchronously, before any await.
   */
  public listen(): this {
    this.scope.addEventListener("message", (event) => {
      void this.onCommand(event.data as DesktopSupervisorCommand);
    });
    return this;
  }

  protected async onCommand(command: DesktopSupervisorCommand): Promise<void> {
    if (command.type === "start") {
      const supervisor = new DesktopSupervisor(this.spawn(command.workerUrl));
      this.supervisor = supervisor;
      supervisor.onCrash((message) => this.onCrash(message));
      const result = await supervisor.start(command.init);
      this.scope.postMessage({ type: "started", result });
      return;
    }
    if (command.type === "window") {
      this.handle = command.handle;
      if (this.crashed) {
        this.terminate(command.handle);
      }
      return;
    }
    if (this.crashed || !this.supervisor) {
      this.scope.postMessage({
        type: "stopped",
        result: {
          graceful: false,
          message: this.crashed ?? "The server was never started.",
        },
      });
      return;
    }
    const result = await this.supervisor.stop();
    this.scope.postMessage({ type: "stopped", result });
  }

  protected onCrash(message: string): void {
    this.crashed = message;
    this.scope.postMessage({ type: "crashed", message });
    if (this.handle !== undefined) {
      this.terminate(this.handle);
    }
  }
}
