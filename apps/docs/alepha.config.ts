import { defineConfig } from "alepha/cli/config";
import { platform } from "alepha/cli/platform";

import pkg from "../../packages/alepha/package.json" with { type: "json" };
import { CheckDocsCommand } from "./scripts/check-docs.ts";
import { DocsCommand } from "./scripts/gen-docs.ts";
import { LlmsCommand } from "./scripts/gen-llms.ts";
import { TreeCommand } from "./scripts/gen-tree.ts";

export default defineConfig({
  // Dev ports live in the 33xx band, which `playwright.port.ts` keeps strictly
  // DISJOINT from the 4300-4999 e2e band. The two used to be the same number,
  // and a running `yarn dev` was then adopted by the e2e suite. Every app
  // without a `dev.port` binds 5173.
  dev: { port: 3302 },
  services: [DocsCommand, TreeCommand, LlmsCommand, CheckDocsCommand],
  // The build resolves commit and build date itself, and serves the lot on
  // `GET /version`. `version` still has to be declared: the docs site deploys
  // on every push to main, while tags exist only on releases, so the built-in
  // git-tag chain would report "latest" on almost every deploy.
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
  // The worker exists for `POST /api/sigil/ingest` and nothing else: docs
  // registers no `$action` of its own, and `@alepha/lore` needs a same-origin
  // endpoint to post to. That endpoint is the one thing a purely static host
  // cannot offer, and it is where the visitor IP becomes a salted hash and
  // where the sigil credential stays instead of shipping to every reader. It
  // is the whole reason this site left GitHub Pages, which could host the
  // files perfectly well and could not host that.
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
  // `static.entries` for `/docs/:slug`), so nothing but the sigil endpoint needs
  // to reach the worker. An app with a `$route` at a root path - which never
  // lives under `/api` - would need that path listed here too.
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
      environments: {
        production: {
          domain: "alepha.dev",
          // ⚠️ A Custom Domain, and the ABSENCE of `zone` is what makes it
          // one. This used to set `zone: "alepha.dev"` to get a Worker Route
          // instead, because the apex still held the four GitHub Pages A
          // records and their AAAA counterparts: a Custom Domain owns its DNS
          // record, so Cloudflare would have refused to create one while they
          // were there.
          //
          // Those eight records were deleted when docs moved onto
          // `lore apps deploy`, which only ever attaches a Custom Domain - a
          // Lore deploy emits no route, deliberately, since a route is
          // zone-scoped and no estate can be probed for a zone it does not
          // know. Cloudflare owns the apex record and its certificate now.
          //
          // Rolling back means re-creating those eight records by hand before
          // anything can serve the apex again, so it is no longer the free
          // undo it was while they existed.
          adapter: "cloudflare",
        },
      },
    }),
  ],
});
