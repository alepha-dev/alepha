import { type Infer, z } from "alepha";

/**
 * A room as the caller sees it (#E161): the room, and their membership when
 * they have one. `joined` is false for an open room they have not joined; a
 * private room is listed only to its members, so it is always `true` there.
 */
export const chatRoomResourceSchema = z.object({
  id: z.uuid(),
  projectId: z.integer(),
  name: z.text(),
  private: z.boolean(),
  archivedAt: z.datetime().optional(),
  createdBy: z.uuid().optional(),
  createdAt: z.datetime(),
  memberCount: z.integer(),
  /**
   * The room's place in the project's list, when someone has ordered it.
   */
  position: z.integer().optional(),
  joined: z.boolean(),
  notifyLevel: z.enum(["mentions", "muted"]).optional(),
  /**
   * The newest message, for the room list's preview: its first line, cut
   * at {@link CHAT_PREVIEW_LENGTH} characters. Absent in a room nobody has
   * written in.
   */
  lastMessage: z
    .object({
      id: z.uuid(),
      createdAt: z.datetime(),
      authorId: z.uuid().optional(),
      agent: z.text().optional(),
      preview: z.text(),
      deleted: z.boolean().optional(),
    })
    .optional(),
});

export const CHAT_PREVIEW_LENGTH = 140;

export type ChatRoomResource = Infer<typeof chatRoomResourceSchema>;
