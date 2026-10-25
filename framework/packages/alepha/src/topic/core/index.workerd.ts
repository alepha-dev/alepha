/**
 * Workerd runs the same memory-only `alepha.topic` as the browser: no Redis
 * client runs in a Worker.
 */
export * from "./index.browser.ts";
