import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";

export const campaignFeaturesSchema = t.object({
  kanban: t.boolean(),
  folios: t.boolean(),
  petitions: t.boolean(),
  chapters: t.boolean(),
  /**
   * Per-quest feature toggles. All default OFF for new campaigns —
   * keeps the quest view minimal until the owner opts in. Reminder
   * and gating additionally need the matching Shop unlock; the Shop
   * `buyFeature` action flips them to ON post-purchase (hybrid
   * "Shop unlocks AND defaults the toggle to ON" pattern).
   */
  questNote: t.optional(t.boolean()),
  questReminder: t.optional(t.boolean()),
  questGating: t.optional(t.boolean()),
  questChrono: t.optional(t.boolean()),
  /**
   * Sigils module toggles. Like the per-quest toggles above, these are
   * intentionally optional and absent from `defaultCampaignFeatures` —
   * adding a key there changes the column DEFAULT and triggers a D1
   * `campaigns` table rebuild that cascade-wipes prod. They default to
   * `false` via the `useCampaignFeatureToggle` hook. Plain module on/off
   * switches — no paywall.
   */
  sigils: t.optional(t.boolean()),
  embeddedPetitions: t.optional(t.boolean()),
  blights: t.optional(t.boolean()),
  beacon: t.optional(t.boolean()),
});

export type CampaignFeatures = Static<typeof campaignFeaturesSchema>;

/**
 * Default feature flags. NB: the per-quest toggles (`questNote`,
 * `questReminder`, `questGating`, `questChrono`) are intentionally
 * absent from this object. Including them here changes the column's
 * Drizzle DEFAULT — and on D1 that triggers a table rebuild
 * (`DROP TABLE campaigns`) which cascade-wipes characters, quests,
 * chapters, folios, petitions. See CLAUDE.md "Migration safety on D1".
 *
 * They're optional in the schema and default to `false` via the
 * `useCampaignFeatureToggle` hook (`persisted[key] ?? false`).
 */
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
     * ISO 639-1 code (e.g. "en", "fr", "ja") the campaign owner picks as
     * the preferred language for AI-generated content. Does NOT affect
     * the UI (that stays under each user's control) — it is surfaced via
     * `campaign_context` so AI agents create quests / folios in this
     * language without the user having to repeat "in French" every turn.
     * `null`/absent means no preference; agents fall back to their
     * default behavior (typically English).
     */
    preferredLanguage: t.optional(t.string()),
    /**
     * Blights retention window, in days. A daily purge cron deletes `open`
     * blights whose `lastSeenAt` is older than this many days (resolved and
     * `quest:`-forwarded blights are kept as audit trail). `null`/absent
     * means fall back to the global 30-day default.
     *
     * NB: declared as `t.optional` with NO `db.default(...)` ON PURPOSE.
     * Adding a Drizzle column DEFAULT triggers a `campaigns` table rebuild
     * on D1 (`DROP TABLE campaigns`) which cascade-wipes child rows — see
     * CLAUDE.md "Migration safety on D1". An optional, default-less column
     * generates a plain additive `ALTER TABLE ADD COLUMN`, which is D1-safe.
     * The 30-day fallback lives in the purge cron (`campaign.retentionDays
     * ?? 30`), not in the column DEFAULT.
     */
    retentionDays: t.optional(t.integer({ minimum: 1, maximum: 3_650 })),
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
    /**
     * Feature keys this campaign has sponsored (paywall economy — see folio
     * "Character — vision and economy"). Append-only: once a feature is
     * unlocked it stays unlocked, even when the sponsor leaves the campaign.
     */
    unlockedFeatures: db.default(t.array(t.string()), []),
    /**
     * Audit log of paywall unlocks — one entry per unlock. Powers the
     * "Sponsored by Alice on 2026-04-12" credit line shown on each feature
     * tile + as a Chronicles event. Append-only.
     */
    unlockHistory: db.default(
      t.array(
        t.object({
          feature: t.string(),
          characterId: t.integer(),
          price: t.integer({ minimum: 0 }),
          at: t.datetime(),
        }),
      ),
      [],
    ),
  }),
  indexes: [
    {
      columns: ["createdBy"],
    },
  ],
});

export type Campaign = Static<typeof campaigns.schema>;
