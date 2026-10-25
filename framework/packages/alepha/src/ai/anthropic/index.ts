import { $module, type Alepha } from "alepha";
import { AiProvider, AlephaAi } from "alepha/ai";

import { AnthropicAiProvider } from "./providers/AnthropicAiProvider.ts";

// Exports
export * from "./providers/AnthropicAiProvider.ts";

/**
 * Plugin for Alepha AI that talks to the Anthropic Messages API, over plain
 * `fetch`: streaming, tool use, prompt caching and typed errors.
 *
 * Registering it makes `AnthropicAiProvider` the `AiProvider`, on every
 * runtime. It needs `AI_API_KEY` and `AI_MODEL` (or a `model` on each
 * `$ai`), and fails at start without them.
 *
 * @see {@link AnthropicAiProvider}
 * @module alepha.ai.anthropic
 */
export const AlephaAiAnthropic = $module({
  name: "alepha.ai.anthropic",
  services: [AnthropicAiProvider],
  register: (alepha: Alepha) => {
    alepha.with({
      optional: true,
      provide: AiProvider,
      use: AnthropicAiProvider,
    });
    return alepha.with(AlephaAi);
  },
});
