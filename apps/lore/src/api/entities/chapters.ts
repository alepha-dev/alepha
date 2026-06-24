import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { campaigns } from "./campaigns.ts";

export const chapters = $entity({
  name: "chapters",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    campaignId: db.ref(z.integer(), () => campaigns.cols.id, {
      onDelete: "cascade",
    }),
    number: z.integer().min(1),
    title: z.string().min(1).max(100),
    description: db.default(z.string().meta({ size: "rich" }), ""),
    /**
     * Auto-close deadline computed at start time from the campaign's
     * `chapterDuration` setting. `null` means manual close only.
     */
    closesAt: z.datetime().optional(),
    closedAt: z.datetime().optional(),
    /**
     * Free-form labels: "v1.0.0", "milestone", "hotfix"…
     */
    tags: db.default(z.array(z.string()), []),
    /**
     * Snapshot markdown rendered at close time. Authoritative changelog
     * for closed chapters. While the chapter is active, the changelog is
     * computed live from completed quests within the chapter's window.
     */
    changelog: z.string().meta({ size: "rich" }).optional(),
  }),
  indexes: [
    { columns: ["campaignId"] },
    { columns: ["campaignId", "number"], unique: true },
  ],
});

export type Chapter = Static<typeof chapters.schema>;
