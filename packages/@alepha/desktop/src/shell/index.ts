import { $module } from "alepha";
import { AlephaSystem } from "alepha/system";

import { DesktopProtocol } from "../core/DesktopProtocol.ts";
import { InstanceLockProvider } from "./providers/InstanceLockProvider.ts";
import { MemoryInstanceLockProvider } from "./providers/MemoryInstanceLockProvider.ts";
import { MemorySupervisorProvider } from "./providers/MemorySupervisorProvider.ts";
import { MemoryWindowProvider } from "./providers/MemoryWindowProvider.ts";
import { NativeInstanceLockProvider } from "./providers/NativeInstanceLockProvider.ts";
import { NativeWindowProvider } from "./providers/NativeWindowProvider.ts";
import { SupervisorProvider } from "./providers/SupervisorProvider.ts";
import { WindowProvider } from "./providers/WindowProvider.ts";
import { WorkerSupervisorProvider } from "./providers/WorkerSupervisorProvider.ts";
import { DesktopPaths } from "./services/DesktopPaths.ts";
import { DesktopShell } from "./services/DesktopShell.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/InstanceLockProvider.ts";
export * from "./providers/MemoryInstanceLockProvider.ts";
export * from "./providers/MemorySupervisorProvider.ts";
export * from "./providers/MemoryWindowProvider.ts";
export * from "./providers/NativeInstanceLockProvider.ts";
export * from "./providers/NativeWindowProvider.ts";
export * from "./providers/SupervisorProvider.ts";
export * from "./providers/WindowProvider.ts";
export * from "./providers/WorkerSupervisorProvider.ts";
export * from "./services/DesktopMain.ts";
export * from "./services/DesktopPaths.ts";
export * from "./services/DesktopShell.ts";
export * from "./services/DesktopSupervisorWorker.ts";
export * from "./services/NativeLoopTerminator.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The main thread of a compiled desktop app: the native window, the instance
 * lock, and the supervisor that owns the server Worker.
 *
 * `alepha compile --desktop` generates the entry that runs it: it creates an
 * Alepha container with this module, points {@link WorkerSupervisorProvider}
 * at the generated supervisor Worker, and exits with what
 * {@link DesktopShell}`.run()` answers.
 *
 * Native code (webview-bun, the Objective-C runtime, `flock`) loads lazily on
 * first use, so importing this module has no native side effect. In tests the
 * window, the lock and the supervisor are memory implementations.
 *
 * macOS only.
 *
 * @module alepha.desktop.shell
 */
export const AlephaDesktopShell = $module({
  name: "alepha.desktop.shell",
  services: [
    AlephaSystem,
    DesktopProtocol,
    DesktopPaths,
    DesktopShell,
    WindowProvider,
    InstanceLockProvider,
    SupervisorProvider,
  ],
  variants: [
    NativeWindowProvider,
    MemoryWindowProvider,
    NativeInstanceLockProvider,
    MemoryInstanceLockProvider,
    WorkerSupervisorProvider,
    MemorySupervisorProvider,
  ],
  register: (alepha) => {
    const test = alepha.isTest();
    return alepha
      .with({
        optional: true,
        provide: WindowProvider,
        use: test ? MemoryWindowProvider : NativeWindowProvider,
      })
      .with({
        optional: true,
        provide: InstanceLockProvider,
        use: test ? MemoryInstanceLockProvider : NativeInstanceLockProvider,
      })
      .with({
        optional: true,
        provide: SupervisorProvider,
        use: test ? MemorySupervisorProvider : WorkerSupervisorProvider,
      });
  },
});
