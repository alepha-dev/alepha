import { AiError } from "./AiError.ts";

/**
 * The model cannot call tools, and the request offered some. An app that
 * needs tools registers another vendor module for it (Anthropic, for
 * example), or picks a model that supports function calling.
 */
export const AiToolsUnsupportedError = AiError.extend({
  name: "AI_TOOLS_UNSUPPORTED",
  message: "The model does not support tool calls",
});

export type AiToolsUnsupportedError = InstanceType<
  typeof AiToolsUnsupportedError
>;
