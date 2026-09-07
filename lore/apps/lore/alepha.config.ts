import { defineConfig } from "alepha/cli/config";
import { devtools } from "alepha/cli/devtools";
import { i18n } from "alepha/cli/i18n";
import { platform } from "alepha/cli/platform";

// The FRAMEWORK's manifest, not Lore's own - the same source `apps/docs` uses.
// Lore is private and therefore carries no version of its own: the release job
// bumps with `--no-private`, so a number here would be decoration that nothing
// maintains. Reading its own manifest silently published `"undefined"` on
// /version, and the framework version is the more useful answer anyway - what
// a continuously deployed app is running.
import pkg from "../../packages/alepha/package.json" with { type: "json" };

export default defineConfig({
  // Dev ports live in the 33xx band, which `playwright.port.ts` keeps strictly
  // DISJOINT from the 4300-4999 e2e band. The two used to be the same number,
  // and a running `yarn dev` was then adopted by the e2e suite. Every app
  // without a `dev.port` binds 5173.
  dev: { port: 3303 },
  // Commit and build date are resolved by the build itself now, and served on
  // `GET /version` by `AlephaServer`. Only `version` is declared here, and it
  // still has to be: Lore deploys on every push to main, while tags exist only
  // on releases, so the built-in git-tag chain would report "latest" on almost
  // every deploy.
  meta: { version: pkg.version },
  // The self-hosted image. `docker run -p 3000:3000 -v lore:/data <image>`
  // and nothing else: everything an operator would otherwise have to pass is
  // baked below, and everything optional stays off until its env var appears.
  //
  // ⚠️ Safe next to the Cloudflare deploy, and checked rather than assumed:
  // `CloudflareAdapter` runs `alepha build -t cloudflare` explicitly, and
  // `BuildDockerTask` returns early on any target but `docker`. It is also
  // purely additive on top of the ordinary build (copy migrations, write a
  // Dockerfile, build an image only with `--image`), so the root `yarn build`
  // now leaves `dist/` Dockerfile-ready with no second build anywhere.
  build: {
    target: "docker",
    docker: {
      // ⚠️ Not the framework's `node:24-alpine` default. `.nvmrc` is v26 and
      // the release workflow runs 26.x, so the default would ship the
      // container on a Node major nothing in CI exercises, with `node:sqlite`
      // still moving between majors. Lore pins its own; the framework default
      // is left alone.
      from: "node:26-alpine",
      image: {
        tag: "ghcr.io/alepha-dev/lore",
        oci: true,
        // All four are config because none can be derived: `package.json` is
        // `private: true` with no description and no license, and `source`
        // must never come from the git remote (a fork would publish the
        // wrong URL, permanently, on a public artifact).
        source: "https://github.com/alepha-dev/alepha",
        title: "Lore",
        description:
          "Project management and telemetry for Alepha applications.",
        licenses: "MIT",
      },
      volumes: ["/data"],
      env: {
        DATA_DIR: "/data",
        // The driver strips the `sqlite://` prefix, so this resolves to
        // `/data/lore.db`, and `NodeSqliteProvider.onStart` migrates it on
        // boot. That is what removes the operator step.
        DATABASE_URL: "sqlite:///data/lore.db",
        // Generated and persisted on first boot. A baked constant would be
        // one token-forgery key shared by every install of a public image.
        APP_SECRET_FILE: "/data/.app_secret",
        SERVER_PORT: "3000",
      },
      // ⚠️ No REGISTRATION_ALLOWED, on purpose. The image ships OPEN, like
      // the deployed instance: `bootstrapFirstUser` makes the first account
      // the administrator, and they close registration from admin in one
      // click. Shipping closed was reversed because its failure mode is
      // unrecoverable - see the comment in `AppSecurityProvider`.
    },
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
        // tr(`agentPrompts.settings.placeholder.${name}`) - the seven
        // placeholder names, and tr(`agentPrompts.settings.${kind}.title` /
        // `.description`) - the four prompt kinds. Both sets are iterated
        // from a constant list, so writing them out would be the same
        // literals twice with nothing keeping them in step.
        "agentPrompts.settings.placeholder.",
        "agentPrompts.settings.epicReview.",
        "agentPrompts.settings.epicActivate.",
        "agentPrompts.settings.questWork.",
        "agentPrompts.settings.feedbackWork.",
        // tr(`feedback.filter.${status}`) - pending/accepted/rejected.
        "feedback.filter.",
        // tr(`feedback.empty.detail.${status}.title` / `.body`) - the detail
        // pane's per-filter empty state. Constructed, never written out.
        "feedback.empty.detail.",
        // tr(`insights.range.${r}`) — 1d/7d/30d.
        "insights.range.",
        // tr(`insights.traffic.${t}`) — all/humans/bots, the Analytics tab's
        // population filter. `.note` under the same prefix is written out in
        // full, so it is exempted here without being hidden by it.
        "insights.traffic.",
        // tr(`insights.vitals.${key}`) — lcp/cls/inp/fcp/ttfb (Web Vitals p75 cards).
        "insights.vitals.",
        // tr(`insights.device.${d.device}`) — mobile/tablet/desktop.
        "insights.device.",
        // tr(`auth.invitation.${status}`): the six ways an invite link can
        // fail to open the register form (accountExists / invalid / expired /
        // accepted / declined / revoked). `auth.invitation.signIn` is written
        // out in full and so is not hidden by this prefix.
        "auth.invitation.",
        // tr(`activity.resource.${type}`) - the Activity table's resource
        // labels, one per `$audit` type declared in `LoreAudits`. Constructed
        // rather than written out because the set is the DECLARATIONS: a new
        // audit type reaches the page the moment it exists, and the call site
        // falls back to the raw value until somebody writes the label.
        "activity.resource.",
        // tr(`blights.origin.${origin}`) — client/server crash provenance badge.
        "blights.origin.",
        // tr(`language.${code}`) — @alepha/ui button-language picker labels.
        "language.",
        // tr(`quest.create.estimate.unit.${unit}`) and its `.one` singular —
        // minutes/hours/days, chosen in the custom estimate popover.
        "quest.create.estimate.unit.",
        // The dashboard's Add-card panel is GENERATED from the metric
        // registry, so every one of these is constructed: the group heading
        // from `descriptor.group`, and the filter field and its options from
        // the metric's own Zod schema. Adding a metric adds keys under these
        // prefixes and touches no component.
        "dashboard.group.",
        "dashboard.filterField.",
        "dashboard.filterValue.",
      ],
    }),
    // Retired app-local commands, kept as notes:
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
  ],
});
