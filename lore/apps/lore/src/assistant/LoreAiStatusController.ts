import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import { LoreAiSwitch } from "./LoreAiSwitch.ts";

/**
 * Whether the assistant answers on this copy, for the web: the header button
 * shows only when it does (#Q3207, #Q3211).
 */
export class LoreAiStatusController {
  protected readonly assistantSwitch = $inject(LoreAiSwitch);

  public readonly aiAssistantStatus = $action({
    method: "GET",
    path: "/assistant/status",
    group: "ai",
    description: "Whether the in-app assistant is enabled on this instance",
    use: [$secure()],
    schema: { response: z.object({ enabled: z.boolean() }) },
    handler: () => ({ enabled: this.assistantSwitch.enabled }),
  });
}
