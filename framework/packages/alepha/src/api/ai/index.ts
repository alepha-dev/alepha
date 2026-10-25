import { $module } from "alepha";
import { AlephaAi } from "alepha/ai";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaApiParameters } from "alepha/api/parameters";

import { AiController } from "./controllers/AiController.ts";
import { AiJobs } from "./jobs/AiJobs.ts";
import { AiBudgetService } from "./services/AiBudgetService.ts";
import { AiChatService } from "./services/AiChatService.ts";
import { AiConversationService } from "./services/AiConversationService.ts";
import { AiSettings } from "./services/AiSettings.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./controllers/AiController.ts";
export * from "./entities/aiConversationEntity.ts";
export * from "./entities/aiMessageEntity.ts";
export * from "./errors/AiBudgetExceededError.ts";
export * from "./errors/AiCallMismatchError.ts";
export * from "./jobs/AiJobs.ts";
export * from "./schemas/aiChatBodySchema.ts";
export * from "./schemas/aiConversationDetailSchema.ts";
export * from "./schemas/aiConversationResourceSchema.ts";
export * from "./schemas/aiMessageResourceSchema.ts";
export * from "./schemas/aiPageContextSchema.ts";
export * from "./schemas/aiPendingCallSchema.ts";
export * from "./schemas/aiResumeBodySchema.ts";
export * from "./schemas/aiStreamEventSchema.ts";
export * from "./services/AiBudgetService.ts";
export * from "./services/AiChatService.ts";
export * from "./services/AiConversationService.ts";
export * from "./services/AiSettings.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The server side of an in-app assistant: conversations stored per user,
 * chat and resume streams over `$sse`, a per-user token budget and turn
 * rate, and a retention sweep.
 *
 * **Features:**
 * - `POST /api/ai/chat` and `POST /api/ai/conversations/:id/resume`
 *   (`$sse`), `GET /api/ai/conversations` and `GET /api/ai/conversations/:id`,
 *   all `$secure()` and scoped to the caller
 * - `ai_conversations` and `ai_messages` entities (the app generates their
 *   migrations, as for every `alepha/api/*` module)
 * - the `api.ai` parameter: `budgetTokens`, `budgetWindowHours`,
 *   `turnsPerMinute`, `retentionDays`, editable at runtime
 *
 * The assistant itself is the app's `$ai`: its prompt and its tools. With
 * several, a chat names the one it talks to.
 *
 * ⚠️ Register the vendor module (`AlephaAiCloudflare`, `AlephaAiOpenai`,
 * `AlephaAiAnthropic`) BEFORE this one: registering this module registers
 * `alepha/ai`, and the first provider substituted is the one used.
 *
 * @module alepha.api.ai
 */
export const AlephaApiAi = $module({
  name: "alepha.api.ai",
  imports: [AlephaAi, AlephaApiJobs, AlephaApiParameters],
  services: [
    AiSettings,
    AiConversationService,
    AiBudgetService,
    AiChatService,
    AiJobs,
    AiController,
  ],
});
