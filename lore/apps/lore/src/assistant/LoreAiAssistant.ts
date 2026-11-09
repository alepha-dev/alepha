import { $inject } from "alepha";
import { $ai } from "alepha/ai";

import { LoreAiPrompt } from "./LoreAiPrompt.ts";
import { LoreAiToolAccess } from "./LoreAiToolAccess.ts";
import { LoreAiToolset } from "./LoreAiToolset.ts";

/**
 * Lore's in-app assistant: its prompt and its tools (#E120).
 *
 * It lives in `apps/lore`, not in `@lore/core`, because its tools come from
 * `@lore/work` and `@lore/knowledge`, and `$ai` reads `tools` once, at init:
 * the class declaring it must inject them, and the app is the one place
 * those modules meet.
 *
 * - `system` is a function of the user: the rules, who asks, today.
 * - The project is not in the prompt: it rides in the page context of each
 *   turn, which `allow` reads to offer what the user may do there.
 */
export class LoreAiAssistant {
  protected readonly prompt = $inject(LoreAiPrompt);
  protected readonly toolset = $inject(LoreAiToolset);
  protected readonly access = $inject(LoreAiToolAccess);

  public readonly assistant = $ai({
    name: "lore",
    // Picked by the model check (#Q3213, `scripts/model-check.ts`, 2026-11-09):
    // 59/60 on twelve prompts against Llama 4 Scout's 50 and Llama 3.3 70B's
    // 20. Set here rather than through `AI_MODEL`, so no copy boots without
    // one.
    model: "@cf/mistralai/mistral-small-3.1-24b-instruct",
    system: ({ user }) => this.prompt.system(user),
    tools: this.toolset.tools,
    allow: (ctx) => this.access.offered(ctx),
    maxTokens: 1024,
  });
}
