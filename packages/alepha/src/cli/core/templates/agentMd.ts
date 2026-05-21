export const agentMd = (): string => {
  return `# AGENTS.md

This is an **Alepha** project.

## Rules

- Always check \`node_modules/alepha/src/\` before suggesting npm packages
- Use \`t\` from Alepha for schemas (not Zod)
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

Supported adapters: \`cloudflare\`, \`vercel\`. The Cloudflare adapter provisions
D1 (or Hyperdrive when \`DATABASE_URL\` is postgres), KV, R2, Queues, and pushes
secrets via \`wrangler secret bulk\`. Set \`build.target: "cloudflare"\` in
\`alepha.config.ts\` if you only want the build artifact without the orchestrator.

## Documentation

- Framework source: \`node_modules/alepha/src/\`
- Docs: https://alepha.dev/llms.txt
`.trim();
};
