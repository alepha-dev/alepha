import { dlopen, FFIType } from "bun:ffi";
import { closeSync, openSync } from "node:fs";

/**
 * An exclusive advisory lock on a file, held by this process until it is
 * released or the process dies, crash included: the kernel drops a `flock`
 * with its last descriptor. That is what makes a second launch of the same
 * app refuse instead of racing the first one's secret and database.
 */
export class Flock {
  protected readonly libc = dlopen(
    process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6",
    {
      flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    },
  ).symbols;
  protected fd?: number;

  /**
   * Take the lock without waiting. False when another process holds it.
   */
  public acquire(path: string): boolean {
    const fd = openSync(path, "a", 0o600);
    // LOCK_EX (2) | LOCK_NB (4)
    if (this.libc.flock(fd, 6) !== 0) {
      closeSync(fd);
      return false;
    }
    this.fd = fd;
    return true;
  }

  public release(): void {
    if (this.fd === undefined) {
      return;
    }
    // LOCK_UN (8)
    this.libc.flock(this.fd, 8);
    closeSync(this.fd);
    this.fd = undefined;
  }
}
