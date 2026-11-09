import { Alepha } from "alepha";
import { AiProvider, type MemoryAiProvider } from "alepha/ai";
import { AiController, type AiStreamEvent } from "alepha/api/ai";
import { ApiKeyService } from "alepha/api/keys";
import type { UserAccountToken } from "alepha/security";

import { LoreAiStatusController, LoreAssistant } from "@/assistant/index.ts";

import { bootLore } from "./bootLore.ts";
import { TestEntityRepositories } from "./entities.ts";

/**
 * Boots Lore the way `main.server.ts` does for the assistant (#E120): the
 * api and MCP layers, then `LoreAssistant`, on `MemoryAiProvider` (no real
 * provider is registered off Workers), with `AI_ASSISTANT_ENABLED` as given.
 *
 * `extra` runs before any module, for a spec's own substitutions.
 */
export const bootAssistant = async (
  options: {
    enabled?: string;
    env?: Record<string, string>;
    extra?: (alepha: Alepha) => void;
  } = {},
) => {
  const alepha = Alepha.create({
    env: {
      DATABASE_URL: ":memory:",
      SERVER_PORT: 0,
      ...(options.enabled === undefined
        ? {}
        : { AI_ASSISTANT_ENABLED: options.enabled }),
      ...options.env,
    },
  });
  options.extra?.(alepha);
  bootLore(alepha, ["api", "mcp"]);
  alepha.with(LoreAssistant);
  const entities = alepha.inject(TestEntityRepositories);
  const keys = alepha.inject(ApiKeyService);
  const controller = alepha.inject(AiController);
  const status = alepha.inject(LoreAiStatusController);
  await alepha.start();

  /**
   * A real user with an API key, for the HTTP endpoints, and the token the
   * in-process calls run as.
   */
  const signIn = async (userId?: string) => {
    const id = userId ?? (await entities.users.create({ roles: ["user"] })).id;
    if (userId) {
      await entities.users.updateById(id, { roles: ["user"] });
    }
    const key = await keys.create({
      userId: id,
      name: "assistant spec",
      roles: ["user"],
    });
    const user: UserAccountToken = { id, roles: ["user"] };
    return {
      id,
      user,
      headers: { authorization: `Bearer ${key.token}` },
    };
  };

  const read = async (res: AsyncIterable<unknown>) => {
    const events: AiStreamEvent[] = [];
    for await (const event of res) {
      events.push(event as AiStreamEvent);
    }
    return events;
  };

  return {
    alepha,
    entities,
    controller,
    status,
    ai: alepha.inject(AiProvider) as MemoryAiProvider,
    signIn,
    read,
  };
};
