import type { DesktopWindowOptions } from "./WindowProvider.ts";
import { WindowProvider } from "./WindowProvider.ts";

/**
 * A window that only records what was asked of it.
 *
 * {@link run} resolves when the spec calls {@link close} (the user closing the
 * window or pressing Cmd+Q) or {@link terminate} (the supervisor unblocking
 * the loop), so a spec plays the native loop by hand.
 */
export class MemoryWindowProvider extends WindowProvider {
  public opened?: DesktopWindowOptions;
  public navigations: string[] = [];
  public alerts: Array<{ title: string; message: string }> = [];
  public destroyed = false;
  public failOpen?: Error;
  protected release?: () => void;
  protected running?: Promise<void>;
  protected ended = false;

  public async open(options: DesktopWindowOptions): Promise<void> {
    if (this.failOpen) {
      throw this.failOpen;
    }
    this.opened = options;
  }

  public navigate(url: string): void {
    this.navigations.push(url);
  }

  public run(): Promise<void> {
    if (this.ended) {
      return Promise.resolve();
    }
    this.running ??= new Promise<void>((resolve) => {
      this.release = resolve;
    });
    return this.running;
  }

  public handle(): number {
    return 4242;
  }

  /**
   * The user closes the window.
   */
  public close(): void {
    this.ended = true;
    this.release?.();
  }

  /**
   * Another thread terminates the loop.
   */
  public terminate(): void {
    this.close();
  }

  /**
   * Resolves once the shell entered the loop.
   */
  public async waitForRun(): Promise<void> {
    while (!this.running && !this.ended) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }

  public async alert(title: string, message: string): Promise<void> {
    this.alerts.push({ title, message });
  }

  public destroy(): void {
    this.destroyed = true;
  }
}
