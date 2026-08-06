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
  plugins: [
    // Cloudflare Workers with static assets: every prerendered page and every
    // bundled asset is served straight from the edge without invoking the
    // worker — free and unlimited on all plans — and the worker runs only for
    // paths no asset matches. Which today is nothing: docs registers no
    // `$action` of its own. It exists so that `@alepha/sigil` has a
    // same-origin `/api/sigil/ingest` to post to, which is the one thing a
    // purely static host cannot offer.
    //
    // `docs.alepha.dev` while `alepha.dev` stays on GitHub Pages. Both deploy
    // from the same build; the apex moves once this one has proven itself.
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
