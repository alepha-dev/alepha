import { $inject, Alepha } from "alepha";
import { $ai, AiProvider } from "alepha/ai";
import { AnthropicAiProvider } from "alepha/ai/anthropic";

import { LoreAiPrompt } from "./LoreAiPrompt.ts";
import { LoreAiToolAccess } from "./LoreAiToolAccess.ts";
import { LoreAiToolset } from "./LoreAiToolset.ts";

/**
 * Lore's in-app assistant: its prompt and its tools (#E120).
 *
 * It lives in `apps/lore`, not in `@lore/core`, because its tools come from
 * `@lore/plan` and `@lore/knowledge`, and the app is the one place those
 * modules meet.
 *
 * - `system` is a function of the user: the rules, who asks, today.
 * - The project is not in the prompt: it rides in the page context of each
 *   turn, which `allow` reads to offer what the user may do there.
 */
export class LoreAiAssistant {
  protected readonly alepha = $inject(Alepha);
  protected readonly provider = $inject(AiProvider);
  protected readonly prompt = $inject(LoreAiPrompt);
  protected readonly toolset = $inject(LoreAiToolset);
  protected readonly access = $inject(LoreAiToolAccess);

  public readonly assistant = $ai({
    name: "lore",
    model: this.defaultModel(),
    system: ({ user }) => this.prompt.system(user),
    // A function, read on the first turn: the tool classes and controllers
    // behind the toolset are created then, not at boot (#Q3398).
    tools: () => this.toolset.tools,
    allow: (ctx) => this.access.offered(ctx),
    maxTokens: 1024,
  });

  /**
   * The model, when the env names none: `AI_MODEL` wins on every vendor.
   *
   * On Workers AI, the one the model check picked (#Q3213,
   * `scripts/model-check.ts`, 2026-11-09): 59/60 on twelve prompts against
   * Llama 4 Scout's 50 and Llama 3.3 70B's 20. On Anthropic, none: a Workers
   * model id means nothing there, and with no `AI_MODEL` the provider refuses
   * to start, naming the variable.
   */
  protected defaultModel(): string | undefined {
    const model = this.alepha.env.AI_MODEL;
    if (typeof model === "string" && model.trim() !== "") {
      return model.trim();
    }
    if (this.provider instanceof AnthropicAiProvider) {
      return undefined;
    }
    return "@cf/mistralai/mistral-small-3.1-24b-instruct";
  }
}
