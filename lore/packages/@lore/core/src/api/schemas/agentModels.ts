/*
 * Browser-loadable (#Q4504): the run dialog lists these, and the server
 * resolves the same aliases, so a new model version is one edit here.
 */

/**
 * One model family an agent CLI runs, as the run dialog offers it: the
 * family's alias, and the id of its latest version, which a run sends.
 */
export interface AgentModelChoice {
  /**
   * The family: `claude-opus`, `gemini-pro`. A run may name it instead of
   * the id; the server resolves it to `model`.
   */
  alias: string;
  /**
   * The family's latest model id today.
   */
  model: string;
}

/**
 * The model families per agent CLI, by Bay's adapter name (#Q4504). An agent
 * CLI with no list here offers no model select: its runs take its own
 * default model. Gemini's is best effort.
 */
export const AGENT_MODELS: Record<string, readonly AgentModelChoice[]> = {
  claude: [
    { alias: "claude-haiku", model: "claude-haiku-5-5" },
    { alias: "claude-sonnet", model: "claude-sonnet-5-5" },
    { alias: "claude-opus", model: "claude-opus-5-5" },
    { alias: "claude-fable", model: "claude-fable-5-2" },
  ],
  gemini: [
    { alias: "gemini-pro", model: "gemini-2.5-pro" },
    { alias: "gemini-flash", model: "gemini-2.5-flash" },
  ],
};
