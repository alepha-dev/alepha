/**
 * The browser-safe schemas of `@lore/chat` (#E161).
 *
 * What another package, a browser page or an end-to-end spec may import as a
 * runtime value. Nothing here reaches a server-only module.
 *
 * @module
 */
export { chatCapabilityOptionsSchema } from "../api/schemas/chatCapabilityOptionsSchema.ts";
export { chatRoomMemberResourceSchema } from "../api/schemas/chatRoomMemberResourceSchema.ts";
export { chatRoomNameSchema } from "../api/schemas/chatRoomNameSchema.ts";
export {
  type ChatRoomResource,
  chatRoomResourceSchema,
} from "../api/schemas/chatRoomResourceSchema.ts";
