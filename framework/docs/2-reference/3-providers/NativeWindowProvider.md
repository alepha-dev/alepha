# NativeWindowProvider

## Import

```typescript
import { NativeWindowProvider } from "@alepha/desktop/shell";
```

## Overview

The macOS window: webview-bun on the main thread, plus a menu and alerts
built through the Objective-C runtime (`ObjcRuntime`).

Everything native is imported lazily, so loading `@alepha/desktop/shell`
(a CLI reading the config, a spec) never opens a library: the first
`open` or `alert` does.

Measured on webview 0.12 (#Q2234): the binding installs no main menu, so
without ours WKWebView gets no Cmd+C/V and there is no Cmd+Q; a second
`run()` after a terminate returns at once, so errors are shown in an
alert, never in the window.
