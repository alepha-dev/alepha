import { z } from "alepha";

import { chatRoomNameSchema } from "../../../schemas/index.ts";

/**
 * The new room dialog's fields (#E161, #Q3955): what `createChatRoom` takes,
 * its `private` read as a Visibility choice (#Q4484), Public by default.
 */
export const newRoomFormSchema = z.object({
  name: chatRoomNameSchema,
  visibility: z.enum(["public", "private"]),
});
