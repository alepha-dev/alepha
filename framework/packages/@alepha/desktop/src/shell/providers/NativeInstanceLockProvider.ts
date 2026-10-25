import { InstanceLockProvider } from "./InstanceLockProvider.ts";

/**
 * {@link InstanceLockProvider} on an exclusive `flock`, which the kernel
 * releases with the process.
 */
export class NativeInstanceLockProvider extends InstanceLockProvider {
  protected lock?: import("../native/Flock.ts").Flock;

  public async acquire(path: string): Promise<boolean> {
    const { Flock } = await import("../native/Flock.ts");
    const lock = new Flock();
    if (!lock.acquire(path)) {
      return false;
    }
    this.lock = lock;
    return true;
  }

  public async release(): Promise<void> {
    this.lock?.release();
    this.lock = undefined;
  }
}
