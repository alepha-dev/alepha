import { BadRequestError } from "alepha/server";

/**
 * An agent job asked of a Lore that cannot start one (#E175): no runner is
 * registered on {@link AgentJobs} (`@lore/prompts` is absent), or, once the
 * capability exists, the project has Prompts off. A 400 that says how to
 * turn it on, so an agent reading it can act.
 */
export const AgentJobsUnavailableError = BadRequestError.extend({
  name: "AGENT_JOBS_UNAVAILABLE",
  message:
    "Agent jobs are not available: Prompts (prompts) runs them. Turn it on in Settings.",
});

export type AgentJobsUnavailableError = InstanceType<
  typeof AgentJobsUnavailableError
>;
