import { lore } from "@alepha/lore/cli";
import { defineConfig } from "alepha/cli/config";
import { infra } from "alepha/cli/infra";

import pkg from "../framework/packages/alepha/package.json" with { type: "json" };
import { CheckDocsCommand } from "./scripts/check-docs.ts";
import { DocsCommand } from "./scripts/gen-docs.ts";
import { LlmsCommand } from "./scripts/gen-llms.ts";
import { TreeCommand } from "./scripts/gen-tree.ts";
import { PinContentCommand } from "./scripts/pin-content.ts";

export default defineConfig({
  // Dev ports live in the 33xx band, which `playwright.port.ts` keeps strictly
  // DISJOINT from the 4300-4999 e2e band. The two used to be the same number,
  // and a running `yarn dev` was then adopted by the e2e suite. Every app
  // without a `dev.port` binds 5173.
  dev: { port: 3302 },
  // The build resolves commit and build date itself, and serves the lot on
  // `GET /version`. `version` is declared from `packages/alepha` rather than
  // read from git: the site deploys from `release.yml` only (#Q2480), where it
  // is the version being published, and a local or CI build of an untagged
  // commit still says which framework version its pages describe.
  meta: { version: pkg.version },
  env: {
    // Here rather than in `.env.production` because the canonical URL is baked
    // into every page at prerender time, so it has to be set for a plain
    // `alepha build` too - and because it is the site's public address, not a
    // secret. `AppRouter` keeps the same value as its schema default, but a
    // `$env` default is only visible to the schema that declares it: the head
    // layer reads `alepha.env`, which sees nothing until a real variable
    // exists. Without this line every page shipped with no canonical and no
    // `og:url`, silently.
    PUBLIC_URL: "https://alepha.dev",
  },
  // ---------------------------------------------------------------------------
  // Cloudflare Workers deploy of the docs at `alepha.dev`.
  //
  // Workers Static Assets is a static host with a worker attached as the
  // fallback: the asset manifest is consulted first, and a match is served from
  // the edge without invoking the worker - free and unlimited on every plan.
  //
  // The worker serves nothing a reader asks for. It exists for
  // `POST /api/sigil/ingest`, where `AlephaSigil` (from the npm
  // `@alepha/lore`) receives page views, Web Vitals and errors: the visitor IP
  // becomes a salted hash there and the `SIGIL_KEY` secret stays on the
  // worker, which a purely static host cannot offer. A page load, an asset and
  // a 404 never invoke it; only the beacon does.
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Static routing: the worker is invoked for `/api/*` and nothing else.
  //
  // Without `run_worker_first`, wrangler sets `has_user_worker` from the
  // presence of `main`, and then - in its own words - "requests not matching an
  // asset will be forwarded to the Worker's code". So every typo, every bot
  // probing for `/wp-login.php`, cost a worker invocation and a full React
  // render, and came back **HTTP 200** carrying the NotFound component. A soft
  // 404 is worse than a slow one: crawlers index it.
  //
  // `not_found_handling` alone does not fix that. It governs `env.ASSETS.fetch()`
  // from inside the worker and the assets-only case - with `main` set it never
  // sees an inbound miss. Naming the worker's routes explicitly is what moves
  // the miss to the asset worker, and only then does `404-page` become
  // reachable and serve the prerendered `404.html` with a real 404.
  //
  // Safe here because every route is prerendered (`static: true`, and
  // `static.entries` for `/docs/:slug`), so nothing but the sigil endpoint
  // needs to reach the worker. An app with a `$route` at a root path - which
  // never lives under `/api` - would need that path listed here too.
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
    DocsCommand,
    TreeCommand,
    LlmsCommand,
    CheckDocsCommand,
    PinContentCommand,
    infra({
      // Deployed by Lore (#Q2701): `lore()` names the copy `docs/production`
      // in Lore project `alepha`, and Lore derives the Worker name
      // `alepha-docs-production` from the project slug, which is the Worker
      // `alepha.dev` already runs on, so the first deploy takes it over in
      // place. The domain is the copy's `url` in Lore, not a field here.
      //
      // Lore mints the sigil on deploy (the manifest declares `SIGIL_KEY`),
      // keeps the copy's secrets, and archives each build as a versioned
      // artifact with rollback. The cost: the adapter runs on this
      // repository's `alepha/cli/infra-lib` while it was compiled against
      // Lore's vendored framework, so an `infra-lib` change can break the
      // docs deploy until `@alepha/lore` republishes.
      //
      // ⚠️ No infra-level `project` here: it would prefix the app name Lore
      // receives (`alepha-docs`), and Lore prefixes its own project slug on
      // top, giving `alepha-alepha-docs-production`, a new Worker.
      environments: {
        production: lore({ project: "alepha", estate: "cf-feunard" }),
      },
    }),
  ],
});
