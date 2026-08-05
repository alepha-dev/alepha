import { $atom, type Infer, z } from "alepha";

/**
 * Tunable limits for feedback. Held as an atom so tests and ops can override
 * via `alepha.store.set(feedbackOptionsAtom, { ... })` without touching code.
 *
 * Defaults are intentionally tight — feedback is user-driven and abuse is
 * cheap to commit. Loosen via configuration if a particular deployment needs
 * higher caps.
 */
export const feedbackOptionsAtom = $atom({
  name: "lore.feedback.options",
  description: "Per-user limits for feedback and attachment uploads",
  schema: z.object({
    /**
     * Max feedback a user can create per day, across all projects.
     */
    maxFeedbackPerUserPerDay: z.integer().min(1).default(5),
    /**
     * Max feedback a single sigil can submit per day, across all users.
     * Caps the blast radius of a leaked sigil — without this a sigil id
     * lifted off a partner page could be weaponized to flood the inbox.
     */
    maxFeedbackPerSigilPerDay: z.integer().min(1).default(50),
    /**
     * Max attachment uploads a user can perform per day, across all feedback.
     */
    maxAttachmentsPerUserPerDay: z.integer().min(1).default(50),
    /**
     * Max attachments per single feedback.
     */
    maxAttachmentsPerFeedback: z.integer().min(1).default(10),
    /**
     * Max file size in bytes for a single attachment.
     */
    maxFileSizeBytes: z
      .integer()
      .min(1)
      .default(5 * 1024 * 1024),
    /**
     * Allowed attachment MIME types. Both extension and MIME are validated at
     * upload time — neither can be fully trusted alone.
     */
    allowedMimeTypes: z
      .array(z.string())
      .default([
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "text/csv",
        "text/plain",
        "application/json",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        "application/pdf",
      ]),
    /**
     * Allowed attachment extensions (lowercased, no leading dot).
     */
    allowedExtensions: z
      .array(z.string())
      .default([
        "png",
        "jpg",
        "jpeg",
        "webp",
        "gif",
        "csv",
        "txt",
        "json",
        "xlsx",
        "xls",
        "pdf",
      ]),
  }),
  default: {
    maxFeedbackPerUserPerDay: 5,
    maxFeedbackPerSigilPerDay: 50,
    maxAttachmentsPerUserPerDay: 50,
    maxAttachmentsPerFeedback: 10,
    maxFileSizeBytes: 5 * 1024 * 1024,
    allowedMimeTypes: [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "text/csv",
      "text/plain",
      "application/json",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "application/pdf",
    ],
    allowedExtensions: [
      "png",
      "jpg",
      "jpeg",
      "webp",
      "gif",
      "csv",
      "txt",
      "json",
      "xlsx",
      "xls",
      "pdf",
    ],
  },
  serverOnly: true,
});

export type FeedbackOptions = Infer<typeof feedbackOptionsAtom.schema>;
