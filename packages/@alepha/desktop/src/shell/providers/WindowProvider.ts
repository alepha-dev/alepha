/**
 * How the one window of a desktop app opens.
 */
export interface DesktopWindowOptions {
  /**
   * The app's display name: the application menu and the Quit item.
   */
  appName: string;
  title: string;
  width: number;
  height: number;
  resizable: boolean;
}

/**
 * The native window of a desktop app, behind which the webview binding and
 * the macOS menu live.
 *
 * ⚠️ {@link run} blocks the thread it is called on until the window closes or
 * the loop is terminated from another thread with the {@link handle}: nothing
 * queued on that thread's event loop runs meanwhile. The shell supervises the
 * server Worker from a Worker of its own for that reason.
 */
export abstract class WindowProvider {
  /**
   * Create the window and its menu (an application menu whose Quit closes
   * the window, and an Edit menu so the webview gets Cmd+C/V/X/A/Z).
   */
  public abstract open(options: DesktopWindowOptions): Promise<void>;

  /**
   * Load a URL in the window.
   */
  public abstract navigate(url: string): void;

  /**
   * Run the window until it closes, Cmd+Q included, or until the loop is
   * terminated through {@link handle}.
   */
  public abstract run(): Promise<void>;

  /**
   * What another thread needs to terminate {@link run}.
   */
  public abstract handle(): number;

  /**
   * A modal native alert. Works before {@link open}, and after a failed one.
   */
  public abstract alert(title: string, message: string): Promise<void>;

  /**
   * Destroy the window, if it is open.
   */
  public abstract destroy(): void;
}
