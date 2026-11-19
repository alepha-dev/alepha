/**
 * The browser-safe schemas of `@lore/chat` (#E161).
 *
 * What another package, a browser page or an end-to-end spec may import as a
 * runtime value. Nothing here reaches a server-only module.
 *
 * @module
 */
export { chatCapabilityOptionsSchema } from "../api/schemas/chatCapabilityOptionsSchema.ts";
export { chatClientFrameSchema } from "../api/schemas/chatClientFrameSchema.ts";
export { chatMessageBodySchema } from "../api/schemas/chatMessageBodySchema.ts";
export {
  type ChatMessageResource,
  chatMessageResourceSchema,
} from "../api/schemas/chatMessageResourceSchema.ts";
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
