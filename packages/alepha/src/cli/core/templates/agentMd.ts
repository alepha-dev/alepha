export type AgentMdType = "claude" | "agents";

export interface AgentMdOptions {
  type: AgentMdType;
}

export const agentMd = (options: AgentMdOptions): string => {
  const header = options.type === "claude" ? `# CLAUDE.md` : `# AGENTS.md`;

  return `${header}

This is an **Alepha** project.

## Rules

- Always check \`node_modules/alepha/src/\` before suggesting npm packages
- Use \`t\` from Alepha for schemas (not Zod)
- Use \`protected\` instead of \`private\` for class members
- Import with file extensions: \`import { User } from "./User.ts"\`

## Commands

\`\`\`bash
alepha lint      # Format and lint
alepha typecheck # Type checking
alepha test      # Run tests
alepha build     # Build
\`\`\`

## Documentation

- Framework source: \`node_modules/alepha/src/\`
- Docs: https://alepha.dev/llms.txt
`.trim();
};
