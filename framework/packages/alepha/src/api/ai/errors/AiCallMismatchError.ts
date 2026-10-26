import { HttpError } from "alepha/server";

/**
 * A resume naming a call the conversation does not wait on: a forged id, a
 * stale tab, or a second approval of a call already claimed. A 409.
 */
export const AiCallMismatchError = HttpError.extend({
  name: "AI_CALL_MISMATCH",
  default: { status: 409 },
  message: "This conversation does not wait on that call",
});

export type AiCallMismatchError = InstanceType<typeof AiCallMismatchError>;
