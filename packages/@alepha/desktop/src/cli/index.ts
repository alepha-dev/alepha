/**
 * The build side of `@alepha/desktop`: what `alepha compile --desktop` calls.
 *
 * `alepha` does not depend on this package. When the flag is used, the CLI
 * resolves `@alepha/desktop/cli` from the app's own dependencies and drives
 * {@link DesktopCompileAdapter} with its file system and shell. Nothing here
 * loads native code.
 *
 * @module alepha.desktop.cli
 */
export * from "./DesktopCompileAdapter.ts";
