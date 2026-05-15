import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";

export const campaignFeaturesSchema = t.object({
  kanban: t.boolean(),
  folios: t.boolean(),
  petitions: t.boolean(),
  chapters: t.boolean(),
});

export type CampaignFeatures = Static<typeof campaignFeaturesSchema>;

export const defaultCampaignFeatures: CampaignFeatures = {
  kanban: true,
  folios: true,
  petitions: true,
  chapters: true,
};

export const campaigns = $entity({
  name: "campaigns",
  schema: t.object({
    id: db.primaryKey(t.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    deletedAt: db.deletedAt(),
    title: t.string({
      minLength: 3,
      maxLength: 24,
    }),
    createdBy: t.uuid(),
    /**
     * @deprecated — the public-campaign feature was removed. Column is kept
     * in the schema to avoid a Drizzle/D1 rebuild migration (which would
     * cascade-wipe child rows on D1 — see CLAUDE.md). No code reads or
     * writes this field. Future PR can drop it with a hand-written safe
     * `ALTER TABLE ... DROP COLUMN`.
     */
    public: t.optional(t.boolean()),
    icon: t.optional(t.uuid()),
    zones: db.default(t.array(t.string()), []),
    features: db.default(campaignFeaturesSchema, defaultCampaignFeatures),
    /**
     * ISO 8601 duration (e.g. "P14D", "P1M") for auto-closing chapters.
     * `null`/absent means chapters close manually only.
     */
    chapterDuration: t.optional(t.string()),
    /**
     * Sub-columns rendered between "New" and "Completed" on the Kanban board.
     * Only meaningful when `features.kanban` is on. Capped at 5 columns by
     * the controller. Default is a single "In Progress" lane so existing
     * accepted quests keep a coherent column to live in.
     */
    kanbanColumns: db.default(
      t.array(t.string({ minLength: 1, maxLength: 24 }), {
        minItems: 1,
        maxItems: 5,
      }),
      ["In Progress"],
    ),
  }),
  indexes: [
    {
      columns: ["createdBy"],
    },
  ],
});

export type Campaign = Static<typeof campaigns.schema>;
