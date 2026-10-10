import type { DesktopStartResult } from "../../core/DesktopSupervisor.ts";
import type { MemoryWindowProvider } from "./MemoryWindowProvider.ts";
import {
  type DesktopInit,
  type DesktopShutdown,
  SupervisorProvider,
} from "./SupervisorProvider.ts";

/**
 * A scripted supervisor for specs. {@link crash} plays the server dying
 * while the window is open: it terminates the attached memory window, as the
 * real supervisor does from its own thread.
 */
export class MemorySupervisorProvider extends SupervisorProvider {
  public startResult: DesktopStartResult = {
    ok: true,
    origin: "http://127.0.0.1:43210",
  };
  public stopResult: DesktopShutdown = { kind: "stopped", graceful: true };
  public init?: DesktopInit;
  public workerUrl?: string;
  public handle?: number;
  public stopped = false;
  public window?: MemoryWindowProvider;
  protected crashed?: string;

  public async start(
    init: DesktopInit,
    workerUrl: string,
  ): Promise<DesktopStartResult> {
    this.init = init;
    this.workerUrl = workerUrl;
    return this.startResult;
  }

  public attachWindow(handle: number): void {
    this.handle = handle;
    if (this.crashed) {
      this.window?.terminate();
    }
  }

  public crash(message: string): void {
    this.crashed = message;
    if (this.handle !== undefined) {
      this.window?.terminate();
    }
  }

  public async stop(): Promise<DesktopShutdown> {
    this.stopped = true;
    if (this.crashed) {
      return { kind: "crashed", message: this.crashed };
    }
    return this.stopResult;
  }
}
