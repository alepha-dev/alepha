/**
 * The browser-safe schemas of `@lore/chat` (#E161).
 *
 * What another package, a browser page or an end-to-end spec may import as a
 * runtime value. Nothing here reaches a server-only module.
 *
 * @module
 */
export { ChatChannels } from "./ChatChannels.ts";
export { chatCapabilityOptionsSchema } from "../api/schemas/chatCapabilityOptionsSchema.ts";
export {
  type ChatClientFrame,
  chatClientFrameSchema,
} from "../api/schemas/chatClientFrameSchema.ts";
export { chatMessageBodySchema } from "../api/schemas/chatMessageBodySchema.ts";
export {
  type ChatMessageResource,
  chatMessageResourceSchema,
} from "../api/schemas/chatMessageResourceSchema.ts";
export {
  type ChatReactionEmoji,
  chatReactionSchema,
} from "../api/schemas/chatReactionSchema.ts";
export {
  type ChatRoomAgentResource,
  chatRoomAgentResourceSchema,
} from "../api/schemas/chatRoomAgentResourceSchema.ts";
export { chatRoomMemberResourceSchema } from "../api/schemas/chatRoomMemberResourceSchema.ts";
export { chatRoomNameSchema } from "../api/schemas/chatRoomNameSchema.ts";
export {
  type ChatRoomResource,
  chatRoomResourceSchema,
} from "../api/schemas/chatRoomResourceSchema.ts";
export {
  type ChatServerFrame,
  chatServerFrameSchema,
} from "../api/schemas/chatServerFrameSchema.ts";
