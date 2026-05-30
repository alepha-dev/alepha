import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { t } from "alepha";
import { defineConfig } from "alepha/cli/config";
import { devtools } from "alepha/cli/devtools";
import { i18n } from "alepha/cli/i18n";
import { platform } from "alepha/cli/platform";
import { $command } from "alepha/command";

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
      // Worker secret allowlist. CI delivers these via the deploy job's
      // `env:` (no `.env.production` on the runner); the deploy `secrets`
      // step resolves each from `.env.<env>` first, then `process.env`, and
      // pushes exactly this set — runner-ambient vars never leak.
      secrets: {
        keys: [
          "APP_SECRET",
          "EMAIL_FROM",
          "GITHUB_CLIENT_ID",
          "GITHUB_CLIENT_SECRET",
          "GOOGLE_CLIENT_ID",
          "GOOGLE_CLIENT_SECRET",
          "TURNSTILE_SECRET_KEY",
          "TURNSTILE_SITE_KEY",
        ],
      },
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
    () => ({
      // Pulling the production D1 into the local dev SQLite is now a
      // baseline command: `alepha platform db export [--env] [--tenant]
      // [--output] [--keep-sql]`. The old app-local `export:db` was
      // promoted upstream (CloudflareAdapter.exportDb) — see Alepha quest
      // #220.

      /**
       * Sync the production R2 bucket into the local dev `buckets/` dir
       * `LocalFileStorageProvider` reads. Requires `rclone` on PATH plus an
       * R2 API token minted ONCE in the Cloudflare dashboard
       * (R2 → Manage R2 API Tokens → Create), stored in `.env` as:
       *
       *   CLOUDFLARE_ACCOUNT_ID=...
       *   R2_ACCESS_KEY_ID=...
       *   R2_SECRET_ACCESS_KEY=...
       *
       * Cloudflare doesn't expose R2 token CRUD via the REST API
       * (`/r2/api-tokens` 404s, `/r2/temp-access-credentials` needs a parent
       * access key) so a temp-token-at-runtime dance isn't possible.
       */
      "export:r2": $command({
        description:
          "Copy the remote R2 bucket into the local dev buckets/ dir (rclone-backed).",
        flags: t.object({
          env: t.optional(t.text({ description: "Platform env." })),
        }),
        handler: async ({ run, flags, root, fs }) => {
          try {
            execSync("rclone version", { stdio: "ignore" });
          } catch {
            throw new Error(
              "rclone not found on PATH. Install it (e.g. `brew install rclone`) and retry.",
            );
          }

          try {
            process.loadEnvFile(`${root}/.env`);
          } catch {
            // .env missing — fall through to env var checks.
          }
          const accessKey = process.env.S3_ACCESS_KEY_ID;
          const secret = process.env.S3_SECRET_ACCESS_KEY;
          const endpoint = process.env.S3_ENDPOINT;
          if (!accessKey || !secret || !endpoint) {
            throw new Error(
              "Need S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY + S3_ENDPOINT in .env. For R2: mint at dash.cloudflare.com → R2 → Manage R2 API Tokens, endpoint is https://<accountId>.r2.cloudflarestorage.com.",
            );
          }

          const env = flags.env ?? "production";
          const bucket = `${pkg.name}-${env}`;
          // R2 keys are `<APP_NAME>/<logicalBucket>/<fileId>` (see
          // CloudflareR2Provider), but LocalFileStorageProvider reads
          // `<logicalBucket>/<fileId>`. Strip the APP_NAME prefix by syncing
          // from the bucket's subpath, not the bucket root.
          const appName = "RDM"; // matches main.server.ts → AlephaBucket APP_NAME
          const destDir = `${root}/node_modules/.alepha/buckets`;
          await fs.mkdir(destDir, { recursive: true });

          await run(
            `rclone copy :s3:${bucket}/${appName} ${destDir}` +
              ` --s3-provider=Cloudflare --s3-region=auto` +
              ` --s3-endpoint=${endpoint}` +
              ` --s3-access-key-id=${accessKey}` +
              ` --s3-secret-access-key=${secret}` +
              ` --transfers=16 --checkers=32`,
            { alias: `syncing R2 ${bucket}/${appName} → ${destDir}` },
          );
        },
      }),
    }),
  ],
});
