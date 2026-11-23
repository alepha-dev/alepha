import type { ChatAgentResource } from "../../../api/schemas/chatAgentResourceSchema.ts";
import type { ChatMentionCandidate } from "../components/ChatComposer.tsx";

// alepha-allow no-module-code: a plain helper the page imports directly, as roomOrder's: no container builds it, so there is nothing to substitute
/**
 * The agents the composer's `@` offers (#E170, #Q4198): every agent the
 * list returns, `lore` first, and none at all with AI off, when no agent
 * would answer.
 */
export const offeredAgents = (
  page: { items: ChatAgentResource[]; enabled: boolean } | undefined,
): ChatMentionCandidate[] =>
  page?.enabled
    ? page.items.map((agent) => ({
        handle: agent.handle,
        label: agent.name,
        agent: true,
        builtin: agent.builtin,
        ...(agent.avatarId ? { avatarId: agent.avatarId } : {}),
      }))
    : [];
