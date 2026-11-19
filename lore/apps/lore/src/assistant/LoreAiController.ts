import { $inject } from "alepha";
import { AiController, type AiEndpoint } from "alepha/api/ai";
import { $secure, type SecureMiddleware } from "alepha/security";
import { NotFoundError } from "alepha/server";

import { LoreAiSwitch } from "./LoreAiSwitch.ts";

/**
 * The framework's assistant endpoints behind Lore's switch (#Q3207).
 *
 * Any signed-in user may talk to the assistant (owner, 2026-11-08): what it
 * may then do is each tool's own gate. With `AI_ASSISTANT_ENABLED` off, every
 * endpoint (`chat`, `resume`, `list`, `detail`) answers 404 to a signed-in
 * caller, as if the module were not mounted. A signed-out caller is refused
 * first, with a 401, whatever the switch says.
 */
export class LoreAiController extends AiController {
  protected override guard(endpoint: AiEndpoint): SecureMiddleware {
    // Injected here, not read from a field: the base class calls this while
    // its own fields are built, before this class's exist.
    const assistantSwitch = $inject(LoreAiSwitch);
    // The conversation list and detail served only the dock, replaced by the
    // member's room in chat (#Q3942): a conversation is read in its room.
    const dockOnly = endpoint === "list" || endpoint === "detail";
    return $secure({
      guard: () => {
        if (!assistantSwitch.enabled || dockOnly) {
          throw new NotFoundError("Not found");
        }
        return true;
      },
    });
  }
}
