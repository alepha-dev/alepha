import { type Infer, z } from "alepha";

/**
 * What `quest_attachment_add` and `folio_attachment_add` answer.
 *
 * ⚠️ Neither tool uploads anything. Both confirm the target exists and hand
 * back the shell command that does - see `AttachmentPushCommand` for why the
 * bytes left MCP, and `AttachmentUploader` for what runs instead.
 *
 * One schema for both, in its own file, because the two surfaces have to agree
 * on the shape of that answer: a second copy is how one of them starts telling
 * an agent something the other does not.
 */
export const attachmentPushResultSchema = z.object({
  command: z
    .string()
    .describe(
      "The command to run, filled in. Run it as printed: `--project` carries the numeric project id, which the CLI takes directly.",
    ),
  authentication: z
    .string()
    .describe(
      "What the shell needs before that line will run. Your MCP credential does not reach it.",
    ),
  projectId: z.integer(),
  shortId: z
    .integer()
    .describe(
      "The target's per-project shortId, as the command addresses it. Confirmed to exist before this was returned.",
    ),
});

export type AttachmentPushResult = Infer<typeof attachmentPushResultSchema>;
