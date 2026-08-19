import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "alepha/cli/config";
import { devtools } from "alepha/cli/devtools";
import { i18n } from "alepha/cli/i18n";
import { platform } from "alepha/cli/platform";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
);
let gitCommit = "unknown";
try {
  gitCommit = execSync("git rev-parse --short HEAD").toString().trim();
} catch {
  // No git (e.g. tarball install). Keep "unknown".
}

export default defineConfig({
  // Dev ports live in the 33xx band, which `playwright.port.ts` keeps strictly
  // DISJOINT from the 4300-4999 e2e band. The two used to be the same number,
  // and a running `yarn dev` was then adopted by the e2e suite. Every app
  // without a `dev.port` binds 5173.
  dev: { port: 3303 },
  env: {
    VITE_VERSION: pkg.version,
    VITE_GIT_COMMIT: gitCommit,
    VITE_BUILD_DATE: new Date().toISOString(),
  },
  plugins: [
    devtools(),
    platform({
      // Worker secrets are auto-detected from the build manifest's `env`
      // list (every `$env`-declared key), so no `secrets.keys` is needed —
      // CI delivers them via the deploy job's `env:` and the deploy step
      // resolves each from `process.env`. Set `secrets.keys` only to override.
      environments: {
        production: {
          domain: "lore.alepha.dev",
          adapter: "cloudflare",
        },
      },
    }),
    i18n({
      // Lore is now a workspace member; `@alepha/ui` lives at
      // ../../packages/@alepha/ui. The i18n scanner needs to see both
      // app source and the shared UI block strings to extract a complete
      // catalog.
      scan: ["src", "../../packages/@alepha/ui/src"],
      dynamicPrefixes: [
        // tr(`folio.type.${kind}`) — kind in directory/folio/blob.
        "folio.type.",
        // tr(`header.connections.state.${state}`) — live/stale/empty.
        "header.connections.state.",
        // tr(`feedback.filter.${status}`) — pending/accepted/rejected/all.
        "feedback.filter.",
        // tr(`insights.range.${r}`) — 1d/7d/30d.
        "insights.range.",
        // tr(`insights.vitals.${key}`) — lcp/cls/inp/fcp/ttfb (Web Vitals p75 cards).
        "insights.vitals.",
        // tr(`insights.device.${d.device}`) — mobile/tablet/desktop.
        "insights.device.",
        // tr(`folios.activity.action.${action}`) — create/edit/rename/tag-change/revert.
        "folios.activity.action.",
        // tr(`folios.editor.status.${draft.statusKey}`) — draft/saved/unsaved.
        "folios.editor.status.",
        // tr(`blights.origin.${origin}`) — client/server crash provenance badge.
        "blights.origin.",
        // tr(`language.${code}`) — @alepha/ui button-language picker labels.
        "language.",
      ],
    }),
    () => ({
      // Pulling the production D1 into the local dev SQLite is now a
      // baseline command: `alepha platform db export [--env] [--tenant]
      // [--output] [--keepSql]`. The old app-local `export:db` was
      // promoted upstream (CloudflareAdapter.exportDb) — see Alepha quest
      // #220.
      // `icons:backfill` lived here on 2026-08-10 and was deleted once it had
      // run. It downscaled the 15 project icons uploaded before
      // `$storage({ image })` existed — 667 KB average, 2 MB peak, all of them
      // rendered into a 32px box — to a 17 KB average, minting a new file id
      // per icon so the `immutable` browser and edge caches missed instead of
      // serving the old bytes for a year. There is no second set to fix; new
      // uploads are bounded by the storage constraint. See Alepha folio #79.
      // `export:r2` lived here until 2026-08-18. It mirrored the production
      // R2 bucket into the local dev `buckets/` dir via `rclone`, and needed
      // a hand-minted R2 API token in `.env` (S3_ACCESS_KEY_ID /
      // S3_SECRET_ACCESS_KEY / S3_ENDPOINT) because Cloudflare exposes no
      // REST CRUD for R2 tokens. There is no upstream replacement yet.
    }),
  ],
});
