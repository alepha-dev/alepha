import { lore } from "@alepha/lore/cli";
import { defineConfig } from "alepha/cli/config";
import { infra } from "alepha/cli/infra";

import pkg from "../../packages/alepha/package.json" with { type: "json" };

export default defineConfig({
  // Dev ports live in the 33xx band, which `playwright.port.ts` keeps strictly
  // DISJOINT from the 4300-4999 e2e band. The two used to be the same number,
  // and a running `yarn dev` was then adopted by the e2e suite. Every app
  // without a `dev.port` binds 5173.
  dev: { port: 3308 },
  // The framework's version, not this app's: the showcase is private and
  // carries no version of its own, and what a continuously deployed showcase
  // is running IS the framework version. Declared rather than left to the
  // built-in git-tag chain because this deploys on every push to main while
  // tags exist only on releases, so the chain would report "latest" almost
  // always. Same reasoning as `apps/docs`.
  meta: { version: pkg.version },
  env: {
    // Here rather than in `.env.production` because it is the site's public
    // address and not a secret, and because it is baked into every page at
    // prerender time - so a plain `alepha build` needs it too.
    PUBLIC_URL: "https://ui.alepha.dev",
  },
  // ---------------------------------------------------------------------------
  // Static routing: the worker is invoked for `/api/*` and nothing else.
  //
  // Every page is prerendered, so the worker is reached only for `/api/*`:
  // `POST /api/sigil/ingest` (where a visitor's IP becomes a salted daily hash
  // and where the sigil credential stays instead of shipping to every reader),
  // and the two showcase actions, which read an in-memory array and touch no
  // database. Close to the `apps/docs` arrangement, with a little more behind
  // `/api`.
  //
  // Without `run_worker_first`, wrangler forwards every non-asset request to
  // the worker, so each bot probing for `/wp-login.php` costs an invocation and
  // a full React render and comes back HTTP 200 carrying the NotFound
  // component. A soft 404 is worse than a slow one: crawlers index it. Naming
  // the worker's routes explicitly moves the miss to the asset worker, which is
  // what makes `not_found_handling` reachable and serves a real 404.
  // ---------------------------------------------------------------------------
  build: {
    cloudflare: {
      config: {
        assets: {
          run_worker_first: ["/api/*"],
          not_found_handling: "404-page",
        },
      },
    },
  },
  plugins: [
    infra({
      // Deployed by Lore (#Q2778), the way `docs/alepha.config.ts` is:
      // `lore()` names the copy `ui/production` (the package name and the
      // environment key) in Lore project `alepha`, and Lore derives the Worker
      // name `alepha-ui-production` from the project slug, which is the Worker
      // `ui.alepha.dev` already runs on (#Q2576), so the first deploy takes it
      // over in place. The domain is the copy's `url` in Lore, not a field
      // here.
      //
      // Lore seals the copy's secrets (every `$env`-declared key the build
      // manifest lists, valued from the job env) and archives each build as a
      // versioned artifact with rollback. It mints a sigil only for a build
      // whose manifest declares `SIGIL_KEY`, which this one does not yet.
      //
      // No infra-level `project` here: it would prefix the app name Lore
      // receives (`alepha-ui`), and Lore prefixes its own project slug on top,
      // giving `alepha-alepha-ui-production`, a new Worker.
      environments: {
        production: lore({ project: "alepha", estate: "cf-feunard" }),
      },
    }),
  ],
});
