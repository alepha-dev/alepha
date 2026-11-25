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
 * `@lore/plan` and `@lore/remember`, and the app is the one place those
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

  /**
   * The model that answers when the `api.ai` parameter names none, or none
   * when the provider picks (Anthropic without `AI_MODEL` refuses to start).
   * A model an operator saved there runs ahead of it (#Q4383), and the
   * panel's header names whichever runs (#Q4269, `LoreAiStatusController`).
   */
  public readonly model = this.defaultModel();

  public readonly assistant = $ai({
    name: "lore",
    model: this.model,
    system: ({ user }) => this.prompt.system(user),
    // A function, read on the first turn: the tool classes and controllers
    // behind the toolset are created then, not at boot (#Q3398).
    tools: () => this.toolset.tools,
    allow: (ctx) => this.access.offered(ctx),
    maxTokens: 1024,
    // Every model call resends ~55 KB of tool definitions with the whole
    // run, so a run's cost grows with its calls (#Q4213: eight calls spent
    // 200k tokens). A run wraps up with an answer at 100k, or before the
    // user's budget; a tool is called four times at most, the same call
    // once; a result is cut at 12 KB, which every tool's typical answer
    // fits (`LoreAiToolset`).
    turnTokens: 100_000,
    maxCallsPerTool: 4,
    maxResultLength: 12 * 1024,
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
