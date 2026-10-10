import { InstanceLockProvider } from "./InstanceLockProvider.ts";

/**
 * {@link InstanceLockProvider} for specs: {@link held} plays another process
 * holding the lock.
 */
export class MemoryInstanceLockProvider extends InstanceLockProvider {
  public held = new Set<string>();
  public acquired?: string;
  public released = false;

  public async acquire(path: string): Promise<boolean> {
    if (this.held.has(path)) {
      return false;
    }
    this.held.add(path);
    this.acquired = path;
    return true;
  }

  public async release(): Promise<void> {
    if (this.acquired) {
      this.held.delete(this.acquired);
    }
    this.released = true;
  }
}
