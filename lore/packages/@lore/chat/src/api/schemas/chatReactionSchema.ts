import { type Infer, z } from "alepha";

/**
 * The emoji a member may react with (#E161, #Q3939): a small fixed set, no
 * custom emoji.
 */
export const chatReactionSchema = z.enum(["👍", "❤️", "😄", "🎉", "👀", "🙏"]);

export type ChatReactionEmoji = Infer<typeof chatReactionSchema>;
