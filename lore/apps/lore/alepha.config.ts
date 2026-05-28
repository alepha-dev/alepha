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
  env: {
    VITE_VERSION: pkg.version,
    VITE_GIT_COMMIT: gitCommit,
    VITE_BUILD_DATE: new Date().toISOString(),
    // Quest #90 — the Lore-self sigil id, seeded on campaign #2 by
    // migration `0024_lore_self_sigil_seed.sql`. The `VITE_` prefix
    // auto-exposes it to the browser bundle; `main.browser.ts` reads it
    // and loads `/sigils/<id>/embed.js` so Lore dogfoods its own crash
    // reporting. MUST match the fixed `id` in that migration.
    VITE_LORE_SELF_SIGIL: "4474024c-d0bf-46d9-b8b0-a562a5d41a60",
  },
  plugins: [
    devtools(),
    platform({
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
        // tr(`archive.type.${kind}`) — kind in directory/folio/blob.
        "archive.type.",
        // tr(`header.connections.state.${state}`) — live/stale/empty.
        "header.connections.state.",
        // tr(`petitions.filter.${status}`) — pending/accepted/rejected/all.
        "petitions.filter.",
        // tr(`insights.range.${r}`) — 1d/7d/30d.
        "insights.range.",
        // tr(`folios.activity.action.${action}`) — create/edit/rename/tag-change/revert.
        "folios.activity.action.",
      ],
    }),
  ],
});
