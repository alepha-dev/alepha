import { AiError } from "./AiError.ts";

/**
 * The vendor refused the credentials (HTTP 401 or 403): a wrong or revoked
 * `AI_API_KEY`.
 */
export const AiAuthError = AiError.extend({
  name: "AI_AUTH",
  message: "The AI provider refused the credentials",
});

export type AiAuthError = InstanceType<typeof AiAuthError>;
