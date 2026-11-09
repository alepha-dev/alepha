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
    system: ({ user }) => this.prompt.system(user),
    tools: this.toolset.tools,
    allow: (ctx) => this.access.offered(ctx),
    maxTokens: 1024,
  });
}
