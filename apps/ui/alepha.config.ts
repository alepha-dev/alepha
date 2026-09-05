import { defineConfig } from "alepha/cli/config";
import { platform } from "alepha/cli/platform";

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
  // always. Same reasoning as `apps/docs` and `apps/lore`.
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
    platform({
      // Worker secrets are auto-detected from the build manifest's `env` list
      // (every `$env`-declared key), so no `secrets.keys` is needed: CI
      // delivers them through the deploy job's `env:` block.
      environments: {
        production: {
          // A Custom Domain, NOT a Worker Route - note the absent `zone`, which
          // is what `apps/docs` sets to get a route instead.
          //
          // Docs needed a Route because the apex still holds the GitHub Pages A
          // and AAAA records, and a Custom Domain owns its DNS record, so
          // Cloudflare would refuse to create one without deleting those first.
          // None of that applies here: `ui.alepha.dev` is a fresh subdomain with
          // no records to preserve, so the simpler form is the correct one and
          // Cloudflare manages the record and the certificate itself.
          domain: "ui.alepha.dev",
          adapter: "cloudflare",
        },
      },
    }),
  ],
});
