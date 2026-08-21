/**
 * `devtools` adds the `## Devtools API` section. Gated on the same flag as the
 * plugin itself: documenting endpoints that were never installed sends the
 * reader to a 404 and costs them the time to work out why.
 *
 * `saas` adds `## Identity`, for the same reason in reverse: the structure
 * table below states there are no variants, which stops being true the moment
 * the preset puts a `Realm.ts` next to `index.ts` and mounts three routers
 * that declare pages no file in `src/web/` mentions. An agent working from the
 * unqualified table looks for the admin console in `AppRouter.ts`, does not
 * find it, and writes a second one.
 */
export const agentMd = (
  opts: { devtools?: boolean; saas?: boolean } = {},
): string => {
  const devtools = opts.devtools
    ? `
## Devtools API (dev server only)

\`alepha dev\` mounts a JSON API over the running app under
\`http://localhost:3000/__devtools/api/\` (port follows \`SERVER_PORT\`). Prefer it
over reading source when the question is about *runtime* state — it answers
from the live container, so it cannot drift from the code.

| Endpoint | Notes |
|---|---|
| \`GET /metadata\` | routes, actions, pages, entities, atoms, modules — the whole app graph |
| \`GET /logs\` | filters: \`level\`, \`type\`, \`module\`, \`search\`, \`since\`, \`limit\`, \`offset\`, \`slowerThan\` |
| \`GET /atoms\` | live store state |
| \`GET /emails\`, \`GET /sms\` | what the app tried to send — captured, never delivered |
| \`GET\`/\`POST /db/:entity/records\` | \`:entity\` is the \`$entity\` name; list takes \`page\`, \`size\`, \`sort\` |
| \`PUT\`/\`DELETE /db/:entity/records/:id\` | edit a row without a database client |
| \`GET /jobs\`, \`GET /jobs/:name/executions\` | \`executions\` takes \`status\` |
| \`POST /jobs/:name/trigger\` | run a job now; \`POST /jobs/executions/:id/retry\` re-runs one |

\`\`\`bash
curl -s http://localhost:3000/__devtools/api/metadata
curl -s "http://localhost:3000/__devtools/api/logs?level=error&limit=50"
curl -s "http://localhost:3000/__devtools/api/db/user/records?size=10"
\`\`\`

There is a UI at \`/__devtools/\` for humans. All of it is a Vite dev-server
plugin — none of it reaches a production build.
`
    : "";

  const saas = opts.saas
    ? `
## Identity

This project uses the \`saas\` preset, so three routers from \`@alepha/ui\` are
registered in \`src/web/index.ts\` and mount pages of their own:

| Route        | Router          | Source                                         |
| ------------ | --------------- | ---------------------------------------------- |
| \`/auth/*\`    | \`AuthRouter\`    | \`@alepha/ui/components/auth/auth-router\`       |
| \`/account/*\` | \`AccountRouter\` | \`@alepha/ui/components/account/account-router\` |
| \`/admin/*\`   | \`AdminRouter\`   | \`@alepha/ui/components/admin/admin-router\`     |

**These pages are not in \`src/web/\`.** Don't write your own login or admin
screen — extend the shells instead: \`$pageAdmin\` and \`$pageAccount\` add a page
to the existing nav in one call. Chrome (branding, nav extras, page props)
goes through \`adminRouterOptionsAtom\` / \`accountRouterOptionsAtom\`, set with
\`alepha.set(...)\` from **both** \`main.server.ts\` and \`main.browser.ts\`.

\`src/api/Realm.ts\` is the switchboard for all of it:

- \`settings.adminEmails\` — the first registration matching one of these is
  promoted to admin. It reads \`ADMIN_EMAIL\`; init wrote your \`git config
user.email\` into \`.env\`, so registering with that address locally makes you
  admin. Every deployed environment must set its own \`ADMIN_EMAIL\`, and one
  that does not promotes nobody.
- \`features\` — \`audits\` and \`apiKeys\` are on; \`jobs\`, \`notifications\`,
  \`avatars\`, \`parameters\` and \`oauth\` each need a provider first. Turning one
  on registers its module _and_ makes its admin/account screens appear.
- \`verifyEmailRequired\` / \`verifyPhoneRequired\` / \`resetPasswordAllowed\`
  each need \`features.notifications\`, because each completes by sending a
  code. Setting one without it refuses to boot rather than running with the
  setting quietly ignored.

Pages hide themselves when the action behind them is missing from
\`/api/_links\`, so a missing nav entry means the module is not mounted, not
that the page is broken.
`
    : "";

  return (
    `# AGENTS.md

This is an **Alepha** project.

## Structure

Every Alepha project has the same layout. There are no variants — put new
code where this table says it goes. Directories marked \`(create)\` are not
scaffolded, because there is nothing to put in them yet; create them under
that exact name when you write the first file.

\`\`\`
src/
├── api/                  # Backend
│   ├── controllers/      # $action endpoints
│   ├── services/         # Business logic            (create)
│   ├── entities/         # $entity definitions       (create)
│   ├── schemas/          # Request/response schemas${
      opts.saas
        ? `
│   ├── Realm.ts          # $realm — auth settings & features`
        : ""
    }
│   └── index.ts          # ApiModule ($module)
├── web/                  # Frontend (React, SSR)
│   ├── components/       # React components
│   ├── AppRouter.ts      # $page routes
│   └── index.ts          # WebModule ($module)
├── main.server.ts        # Server entry
├── main.browser.ts       # Browser entry
└── main.css              # Tailwind entry
\`\`\`

\`src/api/\` and \`src/web/\` each have an \`index.ts\` exporting the \`$module\`
that groups everything below it — register new services there. The
subdirectories are plain folders; they have no \`index.ts\` of their own.

Tailwind is already wired up through \`vite.config.ts\` — style with utility
classes, don't add another CSS framework. The scaffolded home page renders
\`GettingStarted\` from the framework and carries no classes of its own, so
there is no house style to match: the first component you write sets it.

\`vite.config.ts\` also holds the Vitest config, under \`test\`. Don't add a
\`vitest.config.ts\`: one file keeps plugins and path aliases identical between
the build and the tests.

## Environment

\`.env.example\` is the committed list of variables; \`.env\` is gitignored. Copy
one to the other and fill it in.

\`APP_SECRET\` is not optional in production — the app refuses to start without
it, because the built-in default is public and would let anyone forge
authentication tokens. Generate one with \`openssl rand -hex 32\`.

## Rules

- Always check \`node_modules/alepha/src/\` before suggesting npm packages
- Use \`z\` from Alepha for schemas (\`import { z } from "alepha"\`), never \`zod\` directly
- Use \`protected\` instead of \`private\` for class members
- Import with file extensions: \`import { User } from "./User.ts"\`

## Commands

\`\`\`bash
alepha lint              # Format and lint
alepha typecheck         # Type checking
alepha test              # Run tests
alepha build             # Build
alepha platform plan     # Show planned cloud topology (requires platform plugin)
alepha platform up       # Provision + deploy to a configured environment
alepha platform status   # Inspect deployed resources
\`\`\`
${saas}${devtools}
## Testing

- Specs live in \`test/\`, named \`*.spec.ts\`.
- Run with \`alepha test\` (Vitest, embedded in alepha — nothing to install).
- \`test/dummy.spec.ts\` is the starting example; \`Alepha.create()\` is the
  entry point and \`.inject(...)\` resolves providers.

## Cloud deployment (Cloudflare Workers)

Add the \`platform\` plugin to \`alepha.config.ts\` to manage cloud
provisioning, deploy, secrets, and DB migrations end-to-end:

\`\`\`ts
import { defineConfig } from "alepha/cli/config";
import { platform } from "alepha/cli/platform";

export default defineConfig({
  plugins: [
    platform({
      environments: {
        production: {
          adapter: "cloudflare",
          domain: "yourapp.com",
          // zone: "yourapp.com",     // required only for wildcard domains
          // jurisdiction: "eu",       // optional: EU data residency
        },
      },
    }),
  ],
});
\`\`\`

Then: \`alepha platform up --env production\` (auth via \`wrangler login\` on first run).

Supported adapters: \`cloudflare\`, \`bay\`. The Cloudflare adapter provisions
D1 (or Hyperdrive when \`DATABASE_URL\` is postgres), KV, R2, Queues, and pushes
secrets via \`wrangler secret bulk\`. Set \`build.target: "cloudflare"\` in
\`alepha.config.ts\` if you only want the build artifact without the orchestrator.

## Documentation

- Framework source: \`node_modules/alepha/src/\`
- Docs: https://alepha.dev/llms.txt
`.trim() + "\n"
  );
};
