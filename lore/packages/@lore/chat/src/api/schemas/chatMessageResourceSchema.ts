import { type Infer, z } from "alepha";

/**
 * A message as a reader sees it (#E161, #Q3926). A deleted one keeps its id,
 * author and time, and loses its body and mentions.
 */
export const chatMessageResourceSchema = z.object({
  id: z.uuid(),
  roomId: z.uuid(),
  createdAt: z.datetime(),
  authorId: z.uuid().optional(),
  agent: z.text().optional(),
  body: z.text({ size: "rich" }),
  editedAt: z.datetime().optional(),
  deletedAt: z.datetime().optional(),
  /**
   * The members the message mentions, by id.
   */
  mentions: z.array(z.uuid()),
  /**
   * The resources it names, `Q12`, `E3`, `F7`.
   */
  references: z.array(z.text()),
});

export type ChatMessageResource = Infer<typeof chatMessageResourceSchema>;
