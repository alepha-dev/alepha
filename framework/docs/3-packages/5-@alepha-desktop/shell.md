# @alepha/desktop - Shell

## Installation

```bash
npm install @alepha/desktop
```

## Overview

The main thread of a compiled desktop app: the native window, the instance
lock, and the supervisor that owns the server Worker.

`alepha compile --desktop` generates the entry that runs it: it creates an
Alepha container with this module, points `WorkerSupervisorProvider`
at the generated supervisor Worker, and exits with what
`DesktopShell``.run()` answers.

Native code (webview-bun, the Objective-C runtime, `flock`) loads lazily on
first use, so importing this module has no native side effect. In tests the
window, the lock and the supervisor are memory implementations.

macOS only.

## API Reference

### Providers

- [`InstanceLockProvider`](/docs/reference-providers-instancelockprovider) - One running instance per app identifier.
- [`LogFileProvider`](/docs/reference-providers-logfileprovider) - Points the process's stdout and stderr at a file.
- [`MemoryInstanceLockProvider`](/docs/reference-providers-memoryinstancelockprovider) - `InstanceLockProvider` for specs: `held` plays another process
- [`MemoryLogFileProvider`](/docs/reference-providers-memorylogfileprovider) - `LogFileProvider` for specs: records the redirects, and fails when
- [`MemorySupervisorProvider`](/docs/reference-providers-memorysupervisorprovider) - A scripted supervisor for specs. `crash` plays the server dying
- [`MemoryWindowProvider`](/docs/reference-providers-memorywindowprovider) - A window that only records what was asked of it.
- [`NativeInstanceLockProvider`](/docs/reference-providers-nativeinstancelockprovider) - `InstanceLockProvider` on an exclusive `flock`, which the kernel
- [`NativeLogFileProvider`](/docs/reference-providers-nativelogfileprovider) - `LogFileProvider` with `dup2`.
- [`NativeWindowProvider`](/docs/reference-providers-nativewindowprovider) - The macOS window: webview-bun on the main thread, plus a menu and alerts
- [`SupervisorProvider`](/docs/reference-providers-supervisorprovider) - The shell's view of the supervisor: the thread that owns the server Worker
- [`WindowProvider`](/docs/reference-providers-windowprovider) - The native window of a desktop app, behind which the webview binding and
- [`WorkerSupervisorProvider`](/docs/reference-providers-workersupervisorprovider) - `SupervisorProvider` on a real supervisor Worker running
