import { z } from "alepha";

/**
 * The members panel's invite field (#E161, #Q3955): who to add to a private
 * room.
 */
export const roomInviteFormSchema = z.object({
  userId: z.uuid().optional(),
});
