/**
 * Terminates the window loop from the supervisor Worker's thread.
 *
 * The webview library is opened lazily, the first time {@link load} or
 * {@link terminate} is called, so the supervisor Worker can install its
 * message listener before any await. The generated supervisor entry is:
 *
 * ```ts
 * import { DesktopSupervisorWorker, NativeLoopTerminator } from "@alepha/desktop/shell";
 * const terminator = new NativeLoopTerminator();
 * new DesktopSupervisorWorker(self, (handle) => terminator.terminate(handle)).listen();
 * void terminator.load();
 * ```
 */
export class NativeLoopTerminator {
  protected loading?: Promise<
    import("../native/NativeLibrary.ts").NativeLibrary
  >;

  /**
   * Open the library ahead of need. Never rejects: a library that cannot be
   * opened (a headless build on Linux has no window to terminate) is
   * reported when, and only if, a terminate needs it.
   */
  public load(): Promise<unknown> {
    this.loading ??= import("../native/NativeLibrary.ts").then(
      ({ NativeLibrary }) => new NativeLibrary(),
    );
    return this.loading.catch(() => undefined);
  }

  /**
   * Stop the window loop identified by `handle`.
   */
  public terminate(handle: number): void {
    void this.load();
    this.loading
      ?.then((library) => library.terminate(handle))
      .catch((error) => {
        console.error("Cannot terminate the window loop:", error);
      });
  }
}
