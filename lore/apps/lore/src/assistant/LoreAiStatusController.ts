import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import { LoreAiAssistant } from "./LoreAiAssistant.ts";
import { LoreAiSwitch } from "./LoreAiSwitch.ts";

/**
 * Whether the assistant answers on this copy, for the web: the header button
 * shows only when it does (#Q3207, #Q3211), and the panel names the model
 * that answers (#Q4269).
 */
export class LoreAiStatusController {
  protected readonly assistantSwitch = $inject(LoreAiSwitch);
  protected readonly assistant = $inject(LoreAiAssistant);

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
    handler: () => ({
      enabled: this.assistantSwitch.enabled,
      ...(this.assistantSwitch.enabled && this.assistant.model
        ? { model: this.assistant.model }
        : {}),
    }),
  });
}
