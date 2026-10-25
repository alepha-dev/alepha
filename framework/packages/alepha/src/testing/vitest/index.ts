import { fileURLToPath } from "node:url";

import type { TestProjectInlineConfiguration } from "vitest/config";

/**
 * The browser-test project, ready to drop into a vitest config.
 *
 * Written because a browser project is a pile of settings that must agree
 * across every config that declares one, and nothing makes them agree. In this
 * repository that produced a red suite in both directions: an alias added to
 * one config alone (root run red, workspace green), and `execArgv` added to
 * the other alone (workspace run red, root green). Neither command can go red
 * on a setting the other one is missing, so no runner catches that drift.
 *
 * Hence: everything the browser project needs lives here, and a config
 * contributes nothing but its own `include`. Add a jsdom setting here, never
 * to a caller.
 *
 * The project says `extends: true`, so it inherits the declaring config's own
 * `test` block (timeouts, env, globals) the way a sibling node project does.
 * A caller that stamps its settings into every entry instead, as this
 * repository's `vitest.projects.ts` does, spreads the result and overrides
 * `extends` itself.
 *
 * @param include the browser spec patterns, relative to the project root.
 *
 * @example
 * ```ts
 * // vitest.config.ts
 * import { jsdomProject } from "alepha/testing/vitest";
 * import { defineConfig } from "vitest/config";
 *
 * export default defineConfig({
 *   test: {
 *     projects: [
 *       {
 *         extends: true,
 *         test: {
 *           name: "node",
 *           environment: "node",
 *           exclude: ["**\/node_modules/**", "**\/*.browser.spec.{ts,tsx}"],
 *         },
 *       },
 *       jsdomProject(["src/**\/*.browser.spec.{ts,tsx}"]),
 *     ],
 *   },
 * });
 * ```
 */
export const jsdomProject = (
  include: string[] = ["**/*.browser.spec.{ts,tsx}"],
): TestProjectInlineConfiguration => ({
  extends: true,
  test: {
    include,
    name: { label: "jsdom", color: "cyan" },
    environment: "jsdom",
    // Node >= 25 ships a native Web Storage global. Vitest's jsdom environment
    // refuses to overwrite globals that already exist, so the native (unbacked)
    // `localStorage` shadows jsdom's real `Storage` and
    // `window.localStorage.setItem` ends up undefined. Turning the Node
    // built-in off in the test workers lets jsdom install its own
    // spec-compliant implementation.
    execArgv: ["--no-experimental-webstorage"],
    // Polyfills for what jsdom simply does not implement. Resolved from this
    // file rather than named relatively, because callers sit at different
    // depths and, once this ships, inside a different package entirely.
    setupFiles: [fileURLToPath(new URL("setup.ts", import.meta.url))],
  },
  resolve: {
    // A browser build is what a jsdom spec is testing, so the conditions have
    // to say so, or a package's `browser` entry is never picked.
    conditions: ["browser", "module", "import", "default"],
    mainFields: ["browser", "module", "main"],
  },
});

/**
 * Vitest helpers.
 *
 * One shared definition of the jsdom browser-test project, so that every
 * config declaring one agrees on the environment, the Node flags, the resolve
 * conditions and the polyfills instead of rediscovering them.
 *
 * ⚠️ Node only, and config-time only. This is imported by a vitest config, not
 * by app code, and deliberately ships no `index.workerd.ts`.
 *
 * @module alepha.testing.vitest
 */
