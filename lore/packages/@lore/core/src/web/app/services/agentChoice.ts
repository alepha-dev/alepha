/**
 * The host and agent a member runs an agent job with (#Q4223): there is no
 * default Agent host, so the agent entries offer one click when the project
 * has one choice, and one entry per host and agent otherwise, the member's
 * last pick first. The pick is remembered per member in this browser.
 */
export interface AgentChoice {
  host: string;
  agent?: string;
}

// alepha-allow no-module-code: a plain helper module the web imports directly, not a DI service: no container builds it, so there is nothing to substitute
const key = (projectId: number) => `lore.agentChoice.${projectId}`;

// alepha-allow no-module-code: a plain helper module the web imports directly, not a DI service: no container builds it, so there is nothing to substitute
/**
 * The choices, the one this member picked last first.
 */
export const orderAgentChoices = (
  projectId: number,
  choices: AgentChoice[],
): AgentChoice[] => {
  let last: AgentChoice | undefined;
  try {
    const raw = globalThis.localStorage?.getItem(key(projectId));
    last = raw ? (JSON.parse(raw) as AgentChoice) : undefined;
  } catch {
    last = undefined;
  }
  if (!last) return choices;
  const same = (it: AgentChoice) =>
    it.host === last?.host && (it.agent ?? "") === (last?.agent ?? "");
  return [...choices.filter(same), ...choices.filter((it) => !same(it))];
};

// alepha-allow no-module-code: a plain helper module the web imports directly, not a DI service: no container builds it, so there is nothing to substitute
/**
 * Remembers a member's pick for the next run.
 */
export const rememberAgentChoice = (
  projectId: number,
  choice: AgentChoice,
): void => {
  try {
    globalThis.localStorage?.setItem(key(projectId), JSON.stringify(choice));
  } catch {
    // A browser that keeps nothing just asks again.
  }
};

// alepha-allow no-module-code: a plain helper module the web imports directly, not a DI service: no container builds it, so there is nothing to substitute
/**
 * The words an entry adds to its label when there are several choices:
 * `claude on desktop`, or the host alone when it reported no agent yet.
 */
export const agentChoiceText = (choice: AgentChoice): string =>
  choice.agent ? `${choice.agent} @ ${choice.host}` : choice.host;
