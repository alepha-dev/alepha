import { z } from "alepha";

/**
 * One member of a room, as its members panel lists them (#E161).
 */
export const chatRoomMemberResourceSchema = z.object({
  userId: z.uuid(),
  joinedAt: z.datetime(),
  /**
   * The handle a mention spells, `@ada`.
   */
  name: z.text().optional(),
  /**
   * The name shown, "Ada Lovelace".
   */
  label: z.text().optional(),
});
