import { $ai } from "alepha/ai";

/**
 * Lore's in-app assistant: its prompt and its tools (#E120).
 *
 * It lives in `apps/lore`, not in `@lore/core`, because its tools come from
 * `@lore/work` and `@lore/knowledge`, and `$ai` reads `tools` once, at init:
 * the class declaring it must inject them, and the app is the one place
 * those modules meet.
 */
export class LoreAiAssistant {
  public readonly assistant = $ai({
    name: "lore",
    system:
      "You are the assistant of Lore, a project tracker. Answer briefly, in the language the user writes in.",
    tools: [],
    maxTokens: 1024,
  });
}
