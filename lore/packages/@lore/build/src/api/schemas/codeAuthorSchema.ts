import { z } from "alepha";

/**
 * A project member a commit's author email matched (#Q4136): their handle
 * and picture beside the name git recorded.
 */
export const codeAuthorSchema = z.object({
  userId: z.uuid(),
  username: z.text({ maxLength: 100 }).optional(),
  picture: z.text({ maxLength: 2048 }).optional(),
});
