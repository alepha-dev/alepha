import { AiError } from "./AiError.ts";

/**
 * A configuration the AI layer cannot run with: no model, no API key, a
 * missing binding, a tool name a vendor would refuse.
 *
 * Raised at start whenever it can be, so a misconfigured app fails on boot
 * rather than on the first chat.
 */
export const AiConfigError = AiError.extend({
  name: "AI_CONFIG",
  message: "The AI provider is not configured",
});

export type AiConfigError = InstanceType<typeof AiConfigError>;
