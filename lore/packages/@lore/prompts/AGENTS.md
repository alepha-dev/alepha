# AGENTS.md: @lore/prompts

**Prompts** (#E175): the prompt engine, its triggers and pins, the start of agent jobs and their pages, and the agent hosts they run on. It imports `@lore/core` only, and nothing imports it (`check:conventions`, `scripts/lore-package-graph.ts`). Read the repository's `AGENTS.md` first, then `packages/@lore/core/AGENTS.md`.

## Layout

`src/api` (module `LorePromptsApi`), `src/mcp` (`LorePromptsMcp`), `src/web` (`LorePromptsWeb`, which injects `PromptsRouter` from `register()`), `src/schemas`. Strings live in core's locales, like every package's.

## Core keeps the contract

Plan, Ship and Requirements contribute prompts, and a feature package never imports another, so what they write to stays in core and this package fills it. The seams are listed in `packages/@lore/core/AGENTS.md`, "Prompts: the contract".

## Off means off

The capability `prompts` (declared in core's `CapabilityRegistry`, off by default) gates the whole package, on the server, not only in the UI (#Q4314). A change keeps every one of these:

- **Every action** of `PromptController` and `AgentHostController.listProjectAgentHosts` carries `capability: "prompts"` on its `$ownsProject`, so the `prompt_*` tools, `agent_hosts` and `lore prompt` refuse with the usual 400 naming the capability. `checkAgentHost` does not: a host's Agent role is Core, and a host may be lent to a project that has Prompts on.
- **No job starts**: core's `AgentJobs` refuses `start` and `resolve`, and `choices` answers `[]`, for a project with it off.
- **Triggers read the switch when they fire**, never only when they are set: `listening` answers nothing, `settled` drops a pending run, `tick` moves a due row to its next run and starts nothing.
- **A job's end tells nobody** while it is off: `AgentJobProjectEvents` raises no `agent.job.*`, and `PromptReplyMail` sends nothing. A job already running finishes.
- **The pages answer 404** (`PromptsRouter.gate`), Settings > Prompts is not listed, and the spotlight source and the pins slot show nothing.
- **One page is not gated: `bayJobs`** (#Q4524), the Jobs tab of a host's console. The console is a page of the host's home project, which may have Prompts off while it lends the machine to a project that has it on. Its read, `HostJobController.listHostJobs`, is core's and gated on `host:read` in the home project; a job of a project the reader holds no `host:read` in is answered without what that project wrote (`hostMachineJobSchema`). Keep that schema built by hand, field by field.
- **Turning it off deletes nothing**: prompts, triggers, pins and jobs stay. `apps/lore/test/prompts-capability.spec.ts` proves off and on.

Core's test fixture (`createTestProject`) turns `prompts` on by default, like the other capabilities; a spec about Prompts off turns it off.
