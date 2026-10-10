import { dlopen, FFIType } from "bun:ffi";
import { closeSync, openSync } from "node:fs";

/**
 * Process-wide file descriptor plumbing, through libc.
 */
export class Descriptors {
  protected readonly libc = dlopen("/usr/lib/libSystem.B.dylib", {
    dup2: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  }).symbols;

  /**
   * Make fd 1 and fd 2 append to `file` (created 0600).
   */
  public redirectOutput(file: string): void {
    const fd = openSync(file, "a", 0o600);
    try {
      this.libc.dup2(fd, 1);
      this.libc.dup2(fd, 2);
    } finally {
      closeSync(fd);
    }
  }
}
