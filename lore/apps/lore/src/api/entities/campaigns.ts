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
  kanban: false,
  folios: false,
  petitions: false,
  chapters: false,
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
