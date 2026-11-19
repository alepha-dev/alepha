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
  joined: z.boolean(),
  notifyLevel: z.enum(["mentions", "muted"]).optional(),
});

export type ChatRoomResource = Infer<typeof chatRoomResourceSchema>;
