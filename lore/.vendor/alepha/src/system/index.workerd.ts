import { $module } from "alepha";

import { FileSystemProvider } from "./providers/FileSystemProvider.ts";
import { MemoryFileSystemProvider } from "./providers/MemoryFileSystemProvider.ts";
import { MemoryShellProvider } from "./providers/MemoryShellProvider.ts";
import { ShellProvider } from "./providers/ShellProvider.ts";
import { WorkerdFileSystemProvider } from "./providers/WorkerdFileSystemProvider.ts";
import { FileDetector } from "./services/FileDetector.ts";
import { ZipArchive } from "./services/ZipArchive.ts";

export * from "./providers/FileSystemProvider.ts";
export * from "./providers/MemoryFileSystemProvider.ts";
export * from "./providers/MemoryShellProvider.ts";
export * from "./providers/ShellProvider.ts";
export * from "./providers/WorkerdFileSystemProvider.ts";
export * from "./services/FileDetector.ts";
export * from "./services/ZipArchive.ts";

export const AlephaSystem = $module({
  name: "alepha.system",
  services: [FileDetector, FileSystemProvider, ShellProvider, ZipArchive],
  variants: [
    MemoryFileSystemProvider,
    WorkerdFileSystemProvider,
    MemoryShellProvider,
  ],
  register: (alepha) =>
    alepha
      .with({
        optional: true,
        provide: FileSystemProvider,
        use: WorkerdFileSystemProvider,
      })
      .with({
        optional: true,
        provide: ShellProvider,
        use: MemoryShellProvider,
      }),
});
