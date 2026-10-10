import { AlephaError } from "alepha";

import type { DesktopWindowOptions } from "./WindowProvider.ts";
import { WindowProvider } from "./WindowProvider.ts";

/**
 * The macOS window: webview-bun on the main thread, plus a menu and alerts
 * built through the Objective-C runtime (`ObjcRuntime`).
 *
 * Everything native is imported lazily, so loading `@alepha/desktop/shell`
 * (a CLI reading the config, a spec) never opens a library: the first
 * {@link open} or {@link alert} does.
 *
 * Measured on webview 0.12 (#Q2234): the binding installs no main menu, so
 * without ours WKWebView gets no Cmd+C/V and there is no Cmd+Q; a second
 * `run()` after a terminate returns at once, so errors are shown in an
 * alert, never in the window.
 */
export class NativeWindowProvider extends WindowProvider {
  protected webview?: {
    navigate(url: string): void;
    run(): void;
    destroy(): void;
    title: string;
    size: { width: number; height: number; hint: number };
    unsafeHandle: unknown;
  };
  protected objc?: import("../native/ObjcRuntime.ts").ObjcRuntime;

  public async open(options: DesktopWindowOptions): Promise<void> {
    // webview-bun loads the library named by WEBVIEW_PATH when it is set.
    // Only the embedded one is ever loaded.
    delete process.env.WEBVIEW_PATH;
    // Opaque to TypeScript: webview-bun ships its TypeScript source, which
    // does not typecheck under this repository's settings. The cast is erased
    // before bundling, so Bun still sees (and embeds) a literal import.
    const { Webview } = await import("webview-bun" as string);
    const objc = await this.runtime();

    // SizeHint: 0 NONE (resizable), 3 FIXED.
    const webview = new Webview(false, {
      width: options.width,
      height: options.height,
      hint: options.resizable ? 0 : 3,
    }) as unknown as NonNullable<NativeWindowProvider["webview"]>;
    webview.title = options.title;
    objc.installMenu(options.appName);
    this.webview = webview;
    // A Dock Quit or a logout ends the loop like closing the window does, so
    // the server still stops through its hooks.
    const handle = this.handle();
    const { NativeLibrary } = await import("../native/NativeLibrary.ts");
    const library = new NativeLibrary();
    objc.onQuit(() => library.terminate(handle));
  }

  public navigate(url: string): void {
    this.window().navigate(url);
  }

  public async run(): Promise<void> {
    this.window().run();
  }

  public handle(): number {
    return Number(this.window().unsafeHandle);
  }

  public async alert(title: string, message: string): Promise<void> {
    (await this.runtime()).alert(title, message);
  }

  public destroy(): void {
    this.webview?.destroy();
    this.webview = undefined;
  }

  protected window(): NonNullable<NativeWindowProvider["webview"]> {
    if (!this.webview) {
      throw new AlephaError("The desktop window is not open.");
    }
    return this.webview;
  }

  protected async runtime(): Promise<
    import("../native/ObjcRuntime.ts").ObjcRuntime
  > {
    if (!this.objc) {
      const { ObjcRuntime } = await import("../native/ObjcRuntime.ts");
      this.objc = new ObjcRuntime();
    }
    return this.objc;
  }
}
