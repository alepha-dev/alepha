import type { TestProjectInlineConfiguration } from "vitest/config";

/**
 * The browser-test project, shared by every vitest config in the repo.
 *
 * There are two configs — the repo-root one CI runs, and `apps/lore`'s, which
 * only `yarn w lore test` ever loads — and each is invisible to the other's
 * command. That split has now produced a red suite in both directions: the
 * `@/` alias was added to the app config alone (root run red, workspace green),
 * and `execArgv` below was added to the root config alone (workspace run red,
 * root green). Neither command can go red on a setting the other one is
 * missing, so there is no runner that catches this class of drift.
 *
 * Hence: everything the browser project needs lives here, in one place, and a
 * config contributes nothing but its own `include`. Add a jsdom setting here,
 * never to a caller.
 */
export const jsdomProject = (
  include: string[],
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
  },
  resolve: {
    conditions: ["browser", "module", "import", "default"],
    mainFields: ["browser", "module", "main"],
  },
});
