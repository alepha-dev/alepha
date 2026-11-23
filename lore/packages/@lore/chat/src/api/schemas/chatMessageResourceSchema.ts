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
  /**
   * The project's agent that wrote it (#E170), none for `@lore`.
   */
  agentId: z.uuid().optional(),
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
  /**
   * Each emoji under the message, with who reacted, oldest first (#Q3939).
   */
  reactions: z.array(z.object({ emoji: z.text(), userIds: z.array(z.uuid()) })),
  /**
   * The files it carries (#Q3939), served by `/api/files/:id` to whoever
   * may read the room.
   */
  /**
   * An agent's answer: running, paused on a write its mentioner decides,
   * done or failed (#Q3930).
   */
  agentRun: z
    .object({
      status: z.enum(["running", "paused", "done", "failed"]),
      mentionerId: z.uuid(),
      tool: z.text().optional(),
      input: z.record(z.text(), z.any()).optional(),
      tools: z
        .array(
          z.object({
            name: z.text(),
            state: z.enum(["running", "done", "failed"]),
          }),
        )
        .optional(),
    })
    .optional(),
  attachments: z.array(
    z.object({
      id: z.uuid(),
      name: z.text(),
      mimeType: z.text(),
      size: z.number(),
      url: z.text(),
    }),
  ),
});

export type ChatMessageResource = Infer<typeof chatMessageResourceSchema>;
