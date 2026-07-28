import { $module } from "alepha";
import { BunShellProvider } from "./providers/BunShellProvider.ts";
import { FileSystemProvider } from "./providers/FileSystemProvider.ts";
import { MemoryFileSystemProvider } from "./providers/MemoryFileSystemProvider.ts";
import { MemoryShellProvider } from "./providers/MemoryShellProvider.ts";
import { NodeFileSystemProvider } from "./providers/NodeFileSystemProvider.ts";
import { NodeShellProvider } from "./providers/NodeShellProvider.ts";
import { ShellProvider } from "./providers/ShellProvider.ts";
import { WorkerdFileSystemProvider } from "./providers/WorkerdFileSystemProvider.ts";
import { FileDetector } from "./services/FileDetector.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/BunShellProvider.ts";
export * from "./providers/FileSystemProvider.ts";
export * from "./providers/MemoryFileSystemProvider.ts";
export * from "./providers/MemoryShellProvider.ts";
export * from "./providers/NodeFileSystemProvider.ts";
export * from "./providers/NodeShellProvider.ts";
export * from "./providers/ShellProvider.ts";
export * from "./providers/WorkerdFileSystemProvider.ts";
export * from "./services/FileDetector.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * System-level abstractions for portable code across runtimes.
 *
 * **Features:**
 * - File system operations (read, write, exists, etc.)
 * - Shell command execution
 * - File type detection and MIME utilities
 * - Memory implementations for testing
 *
 * @module alepha.system
 */
export const AlephaSystem = $module({
  name: "alepha.system",
  primitives: [],
  services: [FileDetector, FileSystemProvider, ShellProvider],
  variants: [
    MemoryFileSystemProvider,
    NodeFileSystemProvider,
    WorkerdFileSystemProvider,
    MemoryShellProvider,
    NodeShellProvider,
    BunShellProvider,
  ],
  register: (alepha) => {
    const shellImpl = alepha.isTest()
      ? MemoryShellProvider
      : alepha.isBun()
        ? BunShellProvider
        : NodeShellProvider;
    return alepha
      .with({
        optional: true,
        provide: FileSystemProvider,
        use: NodeFileSystemProvider,
      })
      .with({
        optional: true,
        provide: ShellProvider,
        use: shellImpl,
      });
  },
});
