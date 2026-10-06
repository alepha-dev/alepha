/**
 * Prefix used in a blight's `status` column when it has been forwarded to a
 * quest: the status becomes `quest:<questId>`. Shared between the controller
 * (which writes / detects it) and the inbox UI (which strips it for display)
 * so the literal string and its length never drift apart.
 */
export const QUEST_STATUS_PREFIX = "quest:";
