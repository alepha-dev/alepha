import { z } from "alepha";

/**
 * The chat's one field: what the user types.
 */
export const aiChatMessageFormSchema = z.object({
  message: z.text({ size: "rich", minLength: 1 }),
});
