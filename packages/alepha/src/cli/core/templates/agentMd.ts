export const agentMd = (): string => {
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
