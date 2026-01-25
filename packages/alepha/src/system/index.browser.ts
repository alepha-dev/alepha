import { $module } from "alepha";

export * from "./errors/FileError.ts";
export * from "./providers/FileSystemProvider.ts";
export * from "./providers/MemoryFileSystemProvider.ts";
export * from "./providers/MemoryShellProvider.ts";
export * from "./providers/ShellProvider.ts";

export const AlephaSystem = $module({
  name: "alepha.system",
});
