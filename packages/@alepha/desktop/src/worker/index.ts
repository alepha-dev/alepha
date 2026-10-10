/**
 * The Worker side of a desktop app.
 *
 * `alepha compile --desktop` generates a Worker bootstrap that installs a
 * {@link DesktopWorkerHost} and then imports the app's `index.bun.js`. The
 * host takes the application from `run()` (see `RunHost` in `alepha`),
 * starts it only once the whole entry wrapper has run, reports the bound
 * loopback origin to the shell, and runs the stop hooks when the window
 * closes.
 *
 * No native code is reachable from here: the window lives on the main
 * thread, in the shell.
 *
 * @module alepha.desktop.worker
 */
export * from "./DesktopServer.ts";
export * from "./DesktopWorkerHost.ts";
