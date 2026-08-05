/**
 * `devtools` adds the `## Devtools API` section. Gated on the same flag as the
 * plugin itself: documenting endpoints that were never installed sends the
 * reader to a 404 and costs them the time to work out why.
 */
export const agentMd = (opts: { devtools?: boolean } = {}): string => {
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

  return `# AGENTS.md

This is an **Alepha** project.

## Structure

Every Alepha project has the same layout. There are no variants — put new
code where this table says it goes.

\`\`\`
src/
├── api/                  # Backend
│   ├── controllers/      # $action endpoints
│   ├── services/         # Business logic
│   ├── entities/         # $entity definitions
│   ├── schemas/          # Request/response schemas
│   └── index.ts          # ApiModule ($module)
├── web/                  # Frontend (React, SSR)
│   ├── components/       # React components
│   ├── AppRouter.ts      # $page routes
│   └── index.ts          # WebModule ($module)
├── main.server.ts        # Server entry
├── main.browser.ts       # Browser entry
└── main.css              # Tailwind entry
\`\`\`

Every directory has an \`index.ts\` exporting a \`$module\` that groups its
services. Tailwind is already wired up through \`vite.config.ts\` — use
utility classes, don't add another CSS framework.

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
${devtools}
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
`.trim();
};
