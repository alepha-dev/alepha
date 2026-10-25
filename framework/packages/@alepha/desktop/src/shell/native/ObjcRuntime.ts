import { dlopen, FFIType, JSCallback, type Pointer, ptr } from "bun:ffi";

/**
 * The few AppKit calls the desktop shell needs, made through the Objective-C
 * runtime with `bun:ffi`: no compiled native code ships with the package.
 *
 * `objc_msgSend` must be called with the exact prototype of the method on
 * arm64, so each argument shape gets its own typed binding. Only pointer and
 * integer arguments are used, never a float or a struct, which keeps every
 * call ABI-safe.
 */
export class ObjcRuntime {
  /**
   * AppKit, loaded for its classes. Nothing else links it before the webview
   * library does, so without this an alert shown before any window (a second
   * launch) finds no `NSApplication` class and silently shows nothing.
   */
  protected readonly appKit = dlopen(
    "/System/Library/Frameworks/AppKit.framework/AppKit",
    { NSApplicationLoad: { args: [], returns: FFIType.bool } },
  );
  protected readonly lib = "/usr/lib/libobjc.A.dylib";
  protected readonly base = dlopen(this.lib, {
    objc_getClass: { args: [FFIType.cstring], returns: FFIType.ptr },
    sel_registerName: { args: [FFIType.cstring], returns: FFIType.ptr },
    objc_msgSend: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  }).symbols;
  protected readonly send1 = dlopen(this.lib, {
    objc_msgSend: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.ptr,
    },
  }).symbols.objc_msgSend;
  protected readonly send3 = dlopen(this.lib, {
    objc_msgSend: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.ptr,
    },
  }).symbols.objc_msgSend;
  protected readonly sendInt = dlopen(this.lib, {
    objc_msgSend: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.u64],
      returns: FFIType.ptr,
    },
  }).symbols.objc_msgSend;
  protected readonly sendForInt = dlopen(this.lib, {
    objc_msgSend: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i64 },
  }).symbols.objc_msgSend;
  protected readonly runtime = dlopen(this.lib, {
    object_getClass: { args: [FFIType.ptr], returns: FFIType.ptr },
    class_replaceMethod: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.cstring],
      returns: FFIType.ptr,
    },
  }).symbols;
  protected readonly strings: Uint8Array[] = [];
  protected quitCallback?: JSCallback;

  /**
   * The main menu: `<appName>` with `Quit <appName>` (Cmd+Q), and `Edit` with
   * undo, redo, cut, copy, paste and select all, sent down the responder
   * chain to the webview.
   *
   * Quit is `performClose:` on the key window, not `terminate:`: closing the
   * window ends the webview loop, and the shell then stops the server through
   * its stop hooks. `terminate:` would exit the process without them.
   */
  public installMenu(appName: string): void {
    const cmd = 1 << 20;
    const shift = 1 << 17;
    const main = this.send1(
      this.msg(this.cls("NSMenu"), "alloc"),
      this.sel("initWithTitle:"),
      this.ns("Main"),
    ) as Pointer;
    this.send1(
      main,
      this.sel("addItem:"),
      this.submenu(appName, [
        this.item(`Quit ${appName}`, "performClose:", "q"),
      ]),
    );
    this.send1(
      main,
      this.sel("addItem:"),
      this.submenu("Edit", [
        this.item("Undo", "undo:", "z"),
        this.item("Redo", "redo:", "z", cmd | shift),
        this.msg(this.cls("NSMenuItem"), "separatorItem"),
        this.item("Cut", "cut:", "x"),
        this.item("Copy", "copy:", "c"),
        this.item("Paste", "paste:", "v"),
        this.item("Select All", "selectAll:", "a"),
      ]),
    );
    this.send1(this.app(), this.sel("setMainMenu:"), main);
  }

  /**
   * Route a system quit (the Dock's Quit, logout, an AppleScript `quit`)
   * through `onQuit` instead of an immediate exit.
   *
   * Those arrive as `[NSApp terminate:]`, which asks the application
   * delegate `applicationShouldTerminate:` and, with webview's delegate
   * answering nothing, exits on the spot: no stop hook runs (measured,
   * #Q2522). This adds the method to the delegate's class: it calls
   * `onQuit` (which ends the window loop, so the shell stops the server
   * gracefully and exits itself) and answers NSTerminateCancel. The
   * sender of an AppleScript `quit` reads that as "User canceled" although
   * the app does exit; a logout may report the app as having interrupted
   * it once, then proceeds when it is gone.
   */
  public onQuit(onQuit: () => void): void {
    const delegate = this.msg(this.app(), "delegate");
    if (!delegate) {
      return;
    }
    this.quitCallback = new JSCallback(
      () => {
        onQuit();
        // NSTerminateCancel: AppKit's own exit is refused, and the process
        // exits by itself once the server has stopped. NSTerminateLater was
        // measured to park AppKit in a modal wait where the window loop
        // never stops.
        return 0;
      },
      { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.u64 },
    );
    this.runtime.class_replaceMethod(
      this.runtime.object_getClass(delegate),
      this.sel("applicationShouldTerminate:"),
      this.quitCallback.ptr,
      this.cstr("Q@:@"),
    );
  }

  /**
   * A modal warning alert. Activates the app first, so the alert is in front
   * even when no window ever opened.
   */
  public alert(title: string, message: string): void {
    const app = this.app();
    this.msg(app, "finishLaunching");
    // NSApplicationActivationPolicyRegular (0): a Dock icon, and an alert
    // that can come to the front outside a bundle too. Only when it is not
    // already: a bundle launched by Finder is regular, and setting the policy
    // again before activating makes runModal abort after about a second
    // (measured under `open`, #Q2237).
    if (this.int(app, "activationPolicy") !== 0n) {
      this.sendInt(app, this.sel("setActivationPolicy:"), 0);
    }
    this.sendInt(app, this.sel("activateIgnoringOtherApps:"), 1);
    const alert = this.msg(this.msg(this.cls("NSAlert"), "alloc"), "init");
    this.send1(alert, this.sel("setMessageText:"), this.ns(title));
    this.send1(alert, this.sel("setInformativeText:"), this.ns(message));
    // NSAlertStyleCritical
    this.sendInt(alert, this.sel("setAlertStyle:"), 2);
    this.msg(alert, "runModal");
  }

  protected app(): Pointer {
    return this.msg(this.cls("NSApplication"), "sharedApplication");
  }

  protected item(
    title: string,
    action: string | null,
    key: string,
    mods?: number,
  ): Pointer {
    const item = this.send3(
      this.msg(this.cls("NSMenuItem"), "alloc"),
      this.sel("initWithTitle:action:keyEquivalent:"),
      this.ns(title),
      action ? this.sel(action) : null,
      this.ns(key),
    ) as Pointer;
    if (mods !== undefined) {
      this.sendInt(item, this.sel("setKeyEquivalentModifierMask:"), mods);
    }
    return item;
  }

  protected submenu(title: string, items: Pointer[]): Pointer {
    const menu = this.send1(
      this.msg(this.cls("NSMenu"), "alloc"),
      this.sel("initWithTitle:"),
      this.ns(title),
    ) as Pointer;
    for (const item of items) {
      this.send1(menu, this.sel("addItem:"), item);
    }
    const host = this.item(title, null, "");
    this.send1(host, this.sel("setSubmenu:"), menu);
    return host;
  }

  protected cstr(value: string): Pointer {
    const bytes = new TextEncoder().encode(`${value}\0`);
    // Kept alive: the runtime may read the bytes after this call returns.
    this.strings.push(bytes);
    return ptr(bytes);
  }

  protected cls(name: string): Pointer {
    return this.base.objc_getClass(this.cstr(name)) as Pointer;
  }

  protected sel(name: string): Pointer {
    return this.base.sel_registerName(this.cstr(name)) as Pointer;
  }

  protected ns(value: string): Pointer {
    return this.send1(
      this.cls("NSString"),
      this.sel("stringWithUTF8String:"),
      this.cstr(value),
    ) as Pointer;
  }

  protected int(target: Pointer, selector: string): bigint {
    return BigInt(this.sendForInt(target, this.sel(selector)));
  }

  protected msg(target: Pointer, selector: string): Pointer {
    return this.base.objc_msgSend(target, this.sel(selector)) as Pointer;
  }
}
