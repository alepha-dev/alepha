import { z } from "alepha";

import { chatRoomNameSchema } from "../../../schemas/index.ts";

/**
 * The members panel's rename field (#E161, #Q3955).
 */
export const roomRenameFormSchema = z.object({
  name: chatRoomNameSchema,
});
