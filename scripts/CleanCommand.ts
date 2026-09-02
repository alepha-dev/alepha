import { $command } from "alepha/command";

/**
 * `yarn clean` for the whole repository.
 *
 * The CLI ships its own `clean`, which removes one app's `dist`. The CLI keeps
 * the LAST registration for a name and `defineConfig` registers its services
 * after the built-ins, so this one takes the slot for this checkout and the
 * built-in never shows in `--help`.
 */
export class CleanCommand {
  public readonly clean = $command({
    description: "Will remove all generated files.",
    handler: async ({ run }) => {
      await run.rm([
        // The e2e-cli scratch project: a packed tarball plus its own
        // node_modules. `afterAll` removes it, but an interrupted run leaves
        // it behind and it is not small.
        `.e2e-tmp`,
        `coverage`,
        // Two levels: apps live at `apps/<app>` and `apps/examples/<app>`.
        // A single `apps/*/…` silently stopped cleaning everything under
        // `apps/examples/` the moment the examples moved down a level, and
        // a stale `dist` there is exactly what makes an e2e run test the
        // previous build.
        `apps/*/playwright-report`,
        `apps/*/test-results`,
        `apps/*/.playwright`,
        `apps/*/dist`,
        `apps/*/coverage`,
        `apps/*/*/playwright-report`,
        `apps/*/*/test-results`,
        `apps/*/*/.playwright`,
        `apps/*/*/dist`,
        `apps/*/*/coverage`,
        `packages/*/dist`,
        `packages/*/node_modules`,
        `packages/*/coverage`,
        // The scoped packages sit one level deeper.
        `packages/*/*/dist`,
        `packages/*/*/node_modules`,
        `packages/*/*/coverage`,
      ]);
    },
  });
}
