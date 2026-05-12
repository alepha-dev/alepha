import { $atom, type Static, t } from "alepha";

/**
 * Tunable limits for petitions. Held as an atom so tests and ops can override
 * via `alepha.store.set(petitionOptionsAtom, { ... })` without touching code.
 *
 * Defaults are intentionally tight — petitions are user-driven and abuse is
 * cheap to commit. Loosen via configuration if a particular deployment needs
 * higher caps.
 */
export const petitionOptionsAtom = $atom({
  name: "lore.petition.options",
  description: "Per-user limits for petitions and attachment uploads",
  schema: t.object({
    /**
     * Max petitions a user can create per day, across all campaigns.
     */
    maxPetitionsPerUserPerDay: t.integer({ minimum: 1, default: 5 }),
    /**
     * Max attachment uploads a user can perform per day, across all petitions.
     */
    maxAttachmentsPerUserPerDay: t.integer({ minimum: 1, default: 50 }),
    /**
     * Max attachments per single petition.
     */
    maxAttachmentsPerPetition: t.integer({ minimum: 1, default: 10 }),
    /**
     * Max file size in bytes for a single attachment.
     */
    maxFileSizeBytes: t.integer({ minimum: 1, default: 5 * 1024 * 1024 }),
    /**
     * Allowed attachment MIME types. Both extension and MIME are validated at
     * upload time — neither can be fully trusted alone.
     */
    allowedMimeTypes: t.array(t.string(), {
      default: [
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
    }),
    /**
     * Allowed attachment extensions (lowercased, no leading dot).
     */
    allowedExtensions: t.array(t.string(), {
      default: [
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
    }),
  }),
  default: {
    maxPetitionsPerUserPerDay: 5,
    maxAttachmentsPerUserPerDay: 50,
    maxAttachmentsPerPetition: 10,
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
});

export type PetitionOptions = Static<typeof petitionOptionsAtom.schema>;
