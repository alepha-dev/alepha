import { z } from "alepha";

import { chatRoomNameSchema } from "../../../schemas/index.ts";

/**
 * The new room dialog's fields (#E161, #Q3955): what `createChatRoom` takes.
 */
export const newRoomFormSchema = z.object({
  name: chatRoomNameSchema,
  private: z.boolean().optional(),
});
