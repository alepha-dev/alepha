import { defineConfig } from "vitest/config";

import { projects as docs } from "./apps/docs/vitest.config.ts";
import { projects as relations } from "./apps/examples/relations/vitest.config.ts";
import { projects as shop } from "./apps/examples/shop/vitest.config.ts";
import { projects as lore } from "./apps/lore/vitest.config.ts";
import { projects as commerce } from "./packages/@alepha/commerce/vitest.config.ts";
import { projects as devtools } from "./packages/@alepha/devtools/vitest.config.ts";
import { projects as discord } from "./packages/@alepha/discord/vitest.config.ts";
import { projects as loreSdk } from "./packages/@alepha/lore/vitest.config.ts";
import { projects as mqtt } from "./packages/@alepha/mqtt/vitest.config.ts";
import { projects as paymentsMollie } from "./packages/@alepha/payments-mollie/vitest.config.ts";
import { projects as paymentsStripe } from "./packages/@alepha/payments-stripe/vitest.config.ts";
import { projects as protobuf } from "./packages/@alepha/protobuf/vitest.config.ts";
import { projects as ui } from "./packages/@alepha/ui/vitest.config.ts";
import { projects as alepha } from "./packages/alepha/vitest.config.ts";
import { projects as createAlepha } from "./packages/create-alepha/vitest.config.ts";
import { workspaceProjects } from "./vitest.projects.ts";

/**
 * The suite, as one project per workspace.
 *
 * Nothing about a workspace's tests is decided here. Each workspace owns a
 * `vitest.config.ts` that names itself and lists its own settings through
 * `workspaceProjects`, and this file is the import list that makes a root
 * `yarn test` the union of them. A workspace's projects are the same objects
 * whether they are read from here or from `yarn w <workspace> test`.
 *
 * ⚠️ An explicit list, not a glob, and the list is checked rather than
 * trusted: `scripts/check-conventions.ts` fails when a workspace holding spec
 * files is missing a config or is missing from this file. A glob would pick up
 * a new workspace on its own, which sounds better until it does not: a config
 * that fails to match reads exactly like a workspace with no tests, and this
 * repository has paid for that failure mode more than once. An omission that
 * gets reported beats one that gets skipped.
 *
 * This replaced a two-project layout, `node` and `jsdom`, spanning the whole
 * repository from a single root. Three things went with it:
 *
 *   - `yarn w <workspace> test` was a lie everywhere except `apps/lore`. Vitest
 *     walks up for a config, so a workspace without one found THIS file, whose
 *     `test.root` was the repository root: `yarn w @alepha/protobuf test` ran
 *     every spec in the monorepo, and `yarn w alepha test` ran 328 files that
 *     are not in `packages/alepha`.
 *
 *   - `resolve.alias` mapped `@/` to `apps/lore/src` for every spec in the
 *     repository, because Lore needs it and the root run collects Lore's
 *     specs. `examples/shop`, `examples/playground` and `examples/totp` all
 *     declare the same `@/` in their own tsconfig, so the first `@/` import
 *     written in any of them would have resolved into Lore's source. It now
 *     comes from each workspace's own tsconfig, in `vitest.projects.ts`.
 *
 *   - The `node` project excluded `**\/.claude/**` so that a git worktree
 *     checked out under it was not collected twice. Project roots are now
 *     absolute paths into THIS checkout, so a nested one is never reached.
 */
export default defineConfig({
  test: {
    coverage: {
      reporter: ["html"],
      include: ["packages/**/src/**/*.ts", "packages/**/src/**/*.tsx"],
      exclude: [
        "apps/**",
        "scripts/**",
        // ignore experimental packages and tooling.
        //
        // `packages/alepha/src/cli` is deliberately NOT here. It was, until
        // `alepha test --coverage` started publishing this number to Lore:
        // the CLI is where that command and `lore quality push` live,
        // so excluding it would have made the published figure blind to the
        // code that produces it. `vite` and `bin` stay out, so the number
        // reads as "coverage of the alepha framework".
        "packages/@alepha/ui",
        "packages/@alepha/devtools",
        "packages/create-alepha",
        "packages/alepha/src/vite",
        "packages/alepha/src/bin",
      ],
    },
    projects: [
      // The repository root is a workspace too (`alepha-monorepo`), and it
      // holds the tooling specs that belong to no package: `playwright.port.ts`
      // is the live one. `include` is what keeps it to those. Without it this
      // project's root is every other project's parent, and the whole suite is
      // collected a second time.
      ...workspaceProjects(import.meta.url, {
        name: "alepha-monorepo",
        include: ["*.spec.ts", "scripts/**/*.spec.ts"],
      }),
      ...alepha,
      ...commerce,
      ...createAlepha,
      ...devtools,
      ...discord,
      ...docs,
      ...lore,
      ...loreSdk,
      ...mqtt,
      ...paymentsMollie,
      ...paymentsStripe,
      ...protobuf,
      ...relations,
      ...shop,
      ...ui,
    ],
  },
});
