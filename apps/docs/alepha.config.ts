import { defineConfig } from "alepha/cli/config";
import { platform } from "alepha/cli/platform";
import pkg from "../../packages/alepha/package.json" with { type: "json" };
import { CheckDocsCommand } from "./scripts/check-docs.ts";
import { DocsCommand } from "./scripts/gen-docs.ts";
import { LlmsCommand } from "./scripts/gen-llms.ts";
import { TreeCommand } from "./scripts/gen-tree.ts";

export default defineConfig({
  services: [DocsCommand, TreeCommand, LlmsCommand, CheckDocsCommand],
  env: {
    VITE_BUILD_DATE: new Date().toISOString(),
    VITE_VERSION: pkg.version,
  },
  // ---------------------------------------------------------------------------
  // Cloudflare Workers deploy of the docs at `docs.alepha.dev`.
  //
  // Workers Static Assets is a static host with a worker attached as the
  // fallback: the asset manifest is consulted first, and a match is served from
  // the edge without invoking the worker — free and unlimited on every plan.
  // The worker runs only for paths no asset matches, which is essentially just
  // `POST /api/sigil/ingest`: docs registers no `$action` of its own and exists
  // as a worker so `@alepha/sigil` has a same-origin endpoint to post to. That
  // endpoint is the one thing a purely static host cannot offer, and it is
  // where the visitor IP becomes a salted hash and where the sigil credential
  // stays instead of shipping to every reader.
  //
  // This block was parked from 2026-08 until the workerd build stopped emitting
  // a silently BROKEN artifact for this app (exit 0, no warning):
  // `BuildServerTask` rewrote `import.meta.url` textually, so the changelog
  // docs generates from git history — which carries commit messages naming that
  // very token — had a string literal terminated early. The chunk stopped
  // parsing, rolldown dropped it, and the entry shipped as 37 bytes with no
  // `run()` call, which Cloudflare rejected with `ReferenceError: __alepha is
  // not defined`. Both rewrites are now AST-aware and an empty entry chunk
  // fails the build, so the artifact is sound. Only workerd builds ever ran
  // that rewrite, so the GitHub Pages deploy of `alepha.dev` — plain
  // `alepha build`, `dist/public` — was never affected.
  //
  // The `deploy-docs-cloudflare` job in `.github/workflows/ci.yml` is still
  // commented out: deploying is a separate decision from being able to.
  // ---------------------------------------------------------------------------
  plugins: [
    platform({
      environments: {
        production: {
          domain: "docs.alepha.dev",
          adapter: "cloudflare",
        },
      },
    }),
  ],
});
