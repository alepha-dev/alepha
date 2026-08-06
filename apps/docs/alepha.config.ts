import { defineConfig } from "alepha/cli/config";
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
  // PARKED — Cloudflare Workers deploy of the docs at `docs.alepha.dev`.
  //
  // The plan is sound and the shape below is the whole config it needs. Workers
  // Static Assets is a static host with a worker attached as the fallback: the
  // asset manifest is consulted first, and a match is served from the edge
  // without invoking the worker — free and unlimited on every plan. The worker
  // runs only for paths no asset matches, which today is nothing, because docs
  // registers no `$action` of its own. It exists so `@alepha/sigil` can have a
  // same-origin `/api/sigil/ingest` to post to — the one thing a purely static
  // host cannot offer.
  //
  // It is commented out because `alepha build -t cloudflare` currently emits a
  // BROKEN artifact for this app, and does so silently (exit 0, no warning):
  //
  //   `BuildServerTask.stubWorkerdImportMetaUrl` regex-replaces
  //   /import\.meta\.url\b/g across the whole rendered chunk, string literals
  //   included. Docs' changelog is generated from git history, and 0.25.0
  //   carries the commit message "stub import.meta.url in workerd server
  //   chunks…". That text is data, but the regex rewrites it anyway, which
  //   terminates the string early and makes the chunk unparseable. Rolldown
  //   drops the chunk, `run()` goes with it, `globalThis.__alepha` is never
  //   set, and Cloudflare refuses the upload with
  //   `ReferenceError: __alepha is not defined`.
  //
  // Only workerd builds run that rewrite, so the GitHub Pages deploy of
  // `alepha.dev` — plain `alepha build`, `dist/public` — is unaffected.
  //
  // To resume: fix the rewrite to be AST-aware (replace real `import.meta`
  // meta-property nodes, not text inside strings), add a build-time guard that
  // refuses an empty entry chunk instead of shipping it, then uncomment this
  // and the `deploy-docs-cloudflare` job in `.github/workflows/ci.yml`.
  // ---------------------------------------------------------------------------
  //
  // plugins: [
  //   platform({
  //     environments: {
  //       production: {
  //         domain: "docs.alepha.dev",
  //         adapter: "cloudflare",
  //       },
  //     },
  //   }),
  // ],
});
