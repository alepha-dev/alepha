import { $inject, z } from "alepha";
import { AiChatService } from "alepha/api/ai";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import { LoreAiAssistant } from "./LoreAiAssistant.ts";
import { LoreAiSwitch } from "./LoreAiSwitch.ts";

/**
 * Whether the assistant answers on this copy, for the web: the header button
 * shows only when it does (#Q3207, #Q3211), and the panel names the model
 * that answers (#Q4269), the `api.ai` parameter's when one is saved
 * (#Q4383).
 */
export class LoreAiStatusController {
  protected readonly assistantSwitch = $inject(LoreAiSwitch);
  protected readonly assistant = $inject(LoreAiAssistant);
  protected readonly chat = $inject(AiChatService);

  public readonly aiAssistantStatus = $action({
    method: "GET",
    path: "/assistant/status",
    group: "ai",
    description: "Whether the in-app assistant is enabled on this instance",
    use: [$secure()],
    schema: {
      response: z.object({
        enabled: z.boolean(),
        model: z.text().optional(),
      }),
    },
    handler: async () => {
      if (!this.assistantSwitch.enabled) return { enabled: false };
      // The model a turn runs on (#Q4383): the one an operator saved in
      // `api.ai`, else the assistant's own.
      const model = (await this.chat.savedModel()) ?? this.assistant.model;
      return { enabled: true, ...(model ? { model } : {}) };
    },
  });
}
