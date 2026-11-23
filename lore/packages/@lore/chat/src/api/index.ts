import { LoreCoreApi } from "@lore/core/api";
import { $module } from "alepha";
import { AlephaWebSocket } from "alepha/websocket";

import { ChatAgentController } from "./controllers/ChatAgentController.ts";
import { ChatMessageController } from "./controllers/ChatMessageController.ts";
import { ChatRoomController } from "./controllers/ChatRoomController.ts";
import { ChatSocketController } from "./controllers/ChatSocketController.ts";
import { ChatRoomHooks } from "./hooks/ChatRoomHooks.ts";
import { ChatAgentRunner } from "./services/ChatAgentRunner.ts";
import { ChatAgentService } from "./services/ChatAgentService.ts";
import { ChatAudience } from "./services/ChatAudience.ts";
import { ChatBuckets } from "./services/ChatBuckets.ts";
import { ChatChannelRooms } from "./services/ChatChannelRooms.ts";
import { ChatFileAccess } from "./services/ChatFileAccess.ts";
import { ChatLifecycle } from "./services/ChatLifecycle.ts";
import { ChatLive } from "./services/ChatLive.ts";
import { ChatMentionNotifier } from "./services/ChatMentionNotifier.ts";
import { ChatMentionParser } from "./services/ChatMentionParser.ts";
import { ChatMessageService } from "./services/ChatMessageService.ts";
import { ChatResponderRegistry } from "./services/ChatResponderRegistry.ts";
import { ChatRoomMerge } from "./services/ChatRoomMerge.ts";
import { ChatRoomService } from "./services/ChatRoomService.ts";
import { ChatTyping } from "./services/ChatTyping.ts";

/**
 * The server half of `@lore/chat` (#E161): project rooms, where members talk
 * to each other and to the Lore agent.
 *
 * It depends on `@lore/core` only: a feature that spans two modules goes
 * through a core registry or a core link, never through an import of another
 * feature module (`check:conventions`). The agent is not here: the app's
 * assistant registers on this package's registries.
 *
 * Registered by `apps/lore/src/main.server.ts`, after every entry-level
 * substitution.
 *
 * @module
 */
export const LoreChatApi = $module({
  name: "lore.chat.api",
  imports: [LoreCoreApi, AlephaWebSocket],
  services: [
    ChatRoomService,
    ChatRoomHooks,
    ChatRoomMerge,
    ChatLifecycle,
    ChatBuckets,
    ChatFileAccess,
    ChatRoomController,
    ChatSocketController,
    ChatAudience,
    ChatLive,
    ChatMentionParser,
    ChatMessageService,
    ChatMentionNotifier,
    ChatTyping,
    ChatResponderRegistry,
    ChatAgentService,
    ChatAgentRunner,
    ChatMessageController,
    ChatAgentController,
    // Room channels (#Q4052): registered on core's registry at boot.
    ChatChannelRooms,
  ],
});

export { ChatAgentController } from "./controllers/ChatAgentController.ts";
export { ChatMessageController } from "./controllers/ChatMessageController.ts";
export { ChatRoomController } from "./controllers/ChatRoomController.ts";
export { ChatSocketController } from "./controllers/ChatSocketController.ts";
export { type ChatAgent, chatAgents } from "./entities/chatAgents.ts";
export { type ChatMention, chatMentions } from "./entities/chatMentions.ts";
export { type ChatMessage, chatMessages } from "./entities/chatMessages.ts";
export { type ChatReaction, chatReactions } from "./entities/chatReactions.ts";
export { ChatBuckets } from "./services/ChatBuckets.ts";
export { chatRoomMembers } from "./entities/chatRoomMembers.ts";
export { type ChatRoom, chatRooms } from "./entities/chatRooms.ts";
export { ChatAgentRunner } from "./services/ChatAgentRunner.ts";
export { ChatAgentService } from "./services/ChatAgentService.ts";
export {
  type ChatAgentBody,
  type ChatAgentResource,
  chatAgentBodySchema,
  chatAgentResourceSchema,
} from "./schemas/chatAgentResourceSchema.ts";
export { ChatAudience } from "./services/ChatAudience.ts";
export {
  type ChatAgentDecision,
  type ChatAgentEvent,
  type ChatAgentMatch,
  type ChatAgentRequest,
  type ChatResponder,
  ChatResponderRegistry,
} from "./services/ChatResponderRegistry.ts";
export { ChatLifecycle } from "./services/ChatLifecycle.ts";
export { ChatLive } from "./services/ChatLive.ts";
export { ChatMentionNotifier } from "./services/ChatMentionNotifier.ts";
export { ChatMessageService } from "./services/ChatMessageService.ts";
export { ChatTyping } from "./services/ChatTyping.ts";
export { ChatRoomService } from "./services/ChatRoomService.ts";
