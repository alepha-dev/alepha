import { $module } from "alepha";

import { $ai } from "./primitives/$ai.ts";
import { AiProvider } from "./providers/AiProvider.ts";
import { MemoryAiProvider } from "./providers/MemoryAiProvider.ts";
import { AiContextBlock } from "./services/AiContextBlock.ts";
import { AiHttpErrors } from "./services/AiHttpErrors.ts";
import { AiToolSchema } from "./services/AiToolSchema.ts";
import { ChatCompletionFormat } from "./services/ChatCompletionFormat.ts";
import { SseReader } from "./services/SseReader.ts";

// Exports
export * from "./errors/AiAuthError.ts";
export * from "./errors/AiConfigError.ts";
export * from "./errors/AiContextLengthError.ts";
export * from "./errors/AiError.ts";
export * from "./errors/AiOverloadedError.ts";
export * from "./errors/AiRateLimitError.ts";
export * from "./errors/AiToolsUnsupportedError.ts";
export * from "./primitives/$ai.ts";
export * from "./providers/AiProvider.ts";
export * from "./providers/MemoryAiProvider.ts";
export * from "./services/AiContextBlock.ts";
export * from "./services/AiHttpErrors.ts";
export * from "./services/AiToolSchema.ts";
export * from "./services/ChatCompletionFormat.ts";
export * from "./services/SseReader.ts";
export * from "./tools/aiClientTools.ts";

/**
 * AI models behind one provider contract, with no vendor SDK.
 *
 * **Features:**
 * - `$ai`: an assistant whose tools are `$action`s, run as the signed-in
 *   user, mutations confirmed, re-entrant across requests
 * - `AiProvider`: one streamed `chat()` call, text deltas, tool calls and
 *   usage as typed events, and `complete()` to collect them
 * - `MemoryAiProvider`: the default, scripted in specs, and an explicit
 *   placeholder reply in development
 * - `SseReader`: the `text/event-stream` parser every vendor provider shares
 * - `AiToolSchema`: Zod to tool JSON Schema, in input mode
 *
 * The vendor is the module the app registers, never an env string:
 * `AlephaAiCloudflare` (`alepha/ai/cloudflare`, the Workers AI binding),
 * `AlephaAiOpenai` (`alepha/ai/openai`, any OpenAI-compatible endpoint) or
 * `AlephaAiAnthropic` (`alepha/ai/anthropic`). Each substitutes
 * `AiProvider`; without one, `MemoryAiProvider` answers.
 *
 * Everything runs on `fetch` and `ReadableStream`, so on Node, Bun and
 * Workers alike.
 *
 * @module alepha.ai
 */
export const AlephaAi = $module({
  name: "alepha.ai",
  primitives: [$ai],
  services: [
    AiProvider,
    AiContextBlock,
    AiHttpErrors,
    AiToolSchema,
    ChatCompletionFormat,
    SseReader,
  ],
  variants: [MemoryAiProvider],
  register: (alepha) => {
    alepha.with({
      optional: true,
      provide: AiProvider,
      use: MemoryAiProvider,
    });
  },
});
