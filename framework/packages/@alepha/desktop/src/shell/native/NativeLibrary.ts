import { dlopen, FFIType } from "bun:ffi";

import libwebview from "webview-bun/build/libwebview.dylib" with { type: "file" };

/**
 * The webview library embedded in the binary, opened for one call:
 * `webview_terminate`, documented as safe from any thread.
 *
 * The supervisor Worker uses it to unblock the main thread's window loop when
 * the app dies while the window is open (#Q2234): the main thread itself
 * cannot notice, since its event loop does not turn during the loop.
 */
export class NativeLibrary {
  protected terminateSymbol?: (handle: number) => number;

  /**
   * Stop the window loop identified by `handle`, from any thread.
   */
  public terminate(handle: number): void {
    this.terminateSymbol ??= dlopen(libwebview, {
      webview_terminate: { args: [FFIType.ptr], returns: FFIType.i32 },
    }).symbols.webview_terminate as unknown as (handle: number) => number;
    this.terminateSymbol(handle);
  }
}
