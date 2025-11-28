import { t } from "alepha";

/**
 * Chat message schema - server to client
 */
export const chatInSchema = t.object({
  username: t.text(),
  content: t.text(),
  timestamp: t.integer(),
});

/**
 * Chat message schema - client to server
 */
export const chatOutSchema = t.object({
  content: t.text(),
});

/**
 * Chat channel path
 */
export const CHAT_CHANNEL_PATH = "/ws/chat";
