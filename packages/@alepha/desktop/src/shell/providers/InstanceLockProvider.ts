/**
 * One running instance per app identifier.
 *
 * Taken by the shell before the server Worker starts, so before any secret is
 * generated or any database opened: a second launch refuses rather than
 * racing the first one's writes. The lock dies with the process, crash
 * included, so a crash never leaves the app unable to start.
 */
export abstract class InstanceLockProvider {
  /**
   * Take the lock held in the file at `path`. False when another process
   * holds it.
   */
  public abstract acquire(path: string): Promise<boolean>;

  /**
   * Release the lock, if held.
   */
  public abstract release(): Promise<void>;
}
