import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";
import { campaigns } from "./campaigns.ts";

export const chapters = $entity({
  name: "chapters",
  schema: t.object({
    id: db.primaryKey(t.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    campaignId: db.ref(t.integer(), () => campaigns.cols.id, {
      onDelete: "cascade",
    }),
    number: t.integer({ minimum: 1 }),
    title: t.string({ minLength: 1, maxLength: 100 }),
    description: db.default(t.string({ size: "rich" }), ""),
    /**
     * Auto-close deadline computed at start time from the campaign's
     * `chapterDuration` setting. `null` means manual close only.
     */
    closesAt: t.optional(t.datetime()),
    closedAt: t.optional(t.datetime()),
    /**
     * Free-form labels: "v1.0.0", "milestone", "hotfix"…
     */
    tags: db.default(t.array(t.string()), []),
    /**
     * Snapshot markdown rendered at close time. Authoritative changelog
     * for closed chapters. While the chapter is active, the changelog is
     * computed live from completed quests within the chapter's window.
     */
    changelog: t.optional(t.string({ size: "rich" })),
  }),
  indexes: [
    { columns: ["campaignId"] },
    { columns: ["campaignId", "number"], unique: true },
  ],
});

export type Chapter = Static<typeof chapters.schema>;
