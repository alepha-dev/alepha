/*
 * The agent job's permission profiles (#Q3986), fixed in code: Lore picks
 * one, Bay validates every name again, and the profile's Lore tools are the
 * job key's allowlist (#Q3995), checked server side. Claude Code's own tool
 * flags are defence in depth: on the process runner they are the only thing
 * between a `read` job and the jobs user's shell, which is why that runner
 * takes member input only.
 */

export type AgentJobProfile = "read" | "push";

export interface AgentJobProfileSpec {
  maxTurns: number;
  timeoutSeconds: number;
  allowedTools: string[];
  disallowedTools: string[];
  permissionMode?: string;
}

/**
 * The MCP server name Bay writes into the job's `.mcp.json`: Claude Code
 * names its tools `mcp__lore__<tool>`.
 */
export const AGENT_MCP_SERVER = "lore";

export const AGENT_JOB_PROFILES: Record<AgentJobProfile, AgentJobProfileSpec> =
  {
    read: {
      maxTurns: 30,
      timeoutSeconds: 15 * 60,
      allowedTools: [
        "Read",
        "Grep",
        "Glob",
        "Bash(git log:*)",
        "Bash(git show:*)",
      ],
      disallowedTools: ["Write", "Edit", "WebFetch", "WebSearch"],
    },
    push: {
      maxTurns: 100,
      timeoutSeconds: 60 * 60,
      // `yarn`, `yarn v`, git commit and push run through Bash; the job key
      // writes `lore/q<n>` only.
      allowedTools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash"],
      disallowedTools: ["WebFetch", "WebSearch"],
      permissionMode: "acceptEdits",
    },
  };

/**
 * The hosts a `push` job reaches beyond Anthropic and Lore by default: the
 * package registries and GitHub, so the agent can run `yarn` and `yarn v`.
 * A project replaces them with its own list (`projects.agentEgressHosts`,
 * #Q3996). Carried in the spec; only a container runner's proxy enforces it.
 */
export const AGENT_PUSH_EGRESS = [
  "registry.npmjs.org",
  // Yarn's own default registry, which `yarn install` reaches first: found
  // missing when an install was measured through the proxy (#Q3996).
  "registry.yarnpkg.com",
  "repo.yarnpkg.com",
  "github.com",
  "codeload.github.com",
  "objects.githubusercontent.com",
];

/**
 * The most a request's budget raises a profile to (#Q4183): the global
 * triage scales with its items, and stops here. Bay's own limits are wider
 * (500 turns, 4 h).
 */
export const AGENT_BUDGET_CEILING = {
  maxTurns: 300,
  timeoutSeconds: 2 * 3600,
};

/**
 * Every agent job reaches these.
 */
export const AGENT_BASE_EGRESS = ["api.anthropic.com"];
