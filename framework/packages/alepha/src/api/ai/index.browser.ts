import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./schemas/aiChatBodySchema.ts";
export * from "./schemas/aiConversationDetailSchema.ts";
export * from "./schemas/aiConversationResourceSchema.ts";
export * from "./schemas/aiMessageResourceSchema.ts";
export * from "./schemas/aiPageContextSchema.ts";
export * from "./schemas/aiPendingCallSchema.ts";
export * from "./schemas/aiResumeBodySchema.ts";
export * from "./schemas/aiStreamEventSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaApiAi = $module({
  name: "alepha.api.ai",
  services: [],
});
