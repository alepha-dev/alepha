import { $module, type Alepha } from "alepha";
import { AiProvider, AlephaAi } from "alepha/ai";

import { OpenAiCompatibleAiProvider } from "./providers/OpenAiCompatibleAiProvider.ts";

// Exports
export * from "./providers/OpenAiCompatibleAiProvider.ts";

/**
 * Plugin for Alepha AI that talks the OpenAI Chat Completions wire format,
 * over plain `fetch`: OpenAI itself, and every compatible endpoint through
 * `AI_BASE_URL` (Workers AI over REST, OpenRouter, Ollama, vLLM).
 *
 * Registering it makes `OpenAiCompatibleAiProvider` the `AiProvider`, on
 * every runtime. It needs `AI_MODEL` (or a `model` on each `$ai`) and fails
 * at start without one.
 *
 * @see {@link OpenAiCompatibleAiProvider}
 * @module alepha.ai.openai
 */
export const AlephaAiOpenai = $module({
  name: "alepha.ai.openai",
  services: [OpenAiCompatibleAiProvider],
  register: (alepha: Alepha) => {
    alepha.with({
      optional: true,
      provide: AiProvider,
      use: OpenAiCompatibleAiProvider,
    });
    return alepha.with(AlephaAi);
  },
});
