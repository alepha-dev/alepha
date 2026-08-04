import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

export const campaignFeaturesSchema = z.object({
  kanban: z.boolean(),
  folios: z.boolean(),
  /**
   * Gates both the petition inbox (owner triage) and the sigil petition
   * capability (`POST /sigils/:id/petition`). For sigil petitions, ALL
   * three gates must be on: `features.sigils` (master) AND
   * `features.petitions` AND the sigil's `kinds.includes("petition")`.
   * Petitions arrive via TWO paths, both gated on this flag: the
   * first-party form at `/c/:campaignId/request` (route
   * `campaignPetitionRequest`) and the sigil in-app dialog. Both land on
   * `POST /campaigns/:id/petitions`.
   */
  petitions: z.boolean(),
  chapters: z.boolean(),
  /**
   * Per-quest feature toggles. All default OFF for new campaigns —
   * keeps the quest view minimal until the owner opts in. Plain
   * owner-controlled switches: the Shop that used to sell `questReminder`
   * was removed along with the gold economy, so the toggle is now the
   * only gate.
   */
  questNote: z.boolean().optional(),
  questReminder: z.boolean().optional(),
  questChrono: z.boolean().optional(),
  /**
   * Sigils module toggles. Like the per-quest toggles above, these are
   * intentionally optional and absent from `defaultCampaignFeatures` —
   * adding a key there changes the column DEFAULT and triggers a D1
   * `campaigns` table rebuild that cascade-wipes prod. They default to
   * `false` via the `useCampaignFeatureToggle` hook.
   */
  sigils: z.boolean().optional(),
  blights: z.boolean().optional(),
  beacon: z.boolean().optional(),
  vitals: z.boolean().optional(),
  /**
   * Outposts module. Same rules as the sigils family above: optional, and
   * deliberately absent from `defaultCampaignFeatures` so the `features`
   * column DEFAULT is untouched and drizzle-kit emits no table rebuild.
   * Defaults to `false` via the `useCampaignFeatureToggle` hook.
   */
  outposts: z.boolean().optional(),
});

export type CampaignFeatures = Infer<typeof campaignFeaturesSchema>;

/**
 * Default feature flags. NB: the per-quest toggles (`questNote`,
 * `questReminder`, `questChrono`) are intentionally
 * absent from this object. Including them here changes the column's
 * Drizzle DEFAULT — and on D1 that triggers a table rebuild
 * (`DROP TABLE campaigns`) which cascade-wipes members, quests,
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
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    deletedAt: db.deletedAt(),
    title: z.string().min(3).max(24),
    createdBy: z.uuid(),
    /**
     * @deprecated — the public-campaign feature was removed. Column is kept
     * in the schema to avoid a Drizzle/D1 rebuild migration (which would
     * cascade-wipe child rows on D1 — see CLAUDE.md). No code reads or
     * writes this field. Future PR can drop it with a hand-written safe
     * `ALTER TABLE ... DROP COLUMN`.
     */
    public: z.boolean().optional(),
    icon: z.uuid().optional(),
    zones: db.default(z.array(z.string()), []),
    features: db.default(campaignFeaturesSchema, defaultCampaignFeatures),
    /**
     * ISO 8601 duration (e.g. "P14D", "P1M") for auto-closing chapters.
     * `null`/absent means chapters close manually only.
     */
    chapterDuration: z.string().optional(),
    /**
     * ISO 639-1 code (e.g. "en", "fr", "ja") the campaign owner picks as
     * the preferred language for AI-generated content. Does NOT affect
     * the UI (that stays under each user's control) — it is surfaced via
     * `campaign_context` so AI agents create quests / folios in this
     * language without the user having to repeat "in French" every turn.
     * `null`/absent means no preference; agents fall back to their
     * default behavior (typically English).
     */
    preferredLanguage: z.string().optional(),
    /**
     * Blights retention window, in days. A daily purge cron deletes `open`
     * blights whose `lastSeenAt` is older than this many days (resolved and
     * `quest:`-forwarded blights are kept as audit trail). `null`/absent
     * means fall back to the global 30-day default.
     *
     * NB: declared as `z.optional` with NO `db.default(...)` ON PURPOSE.
     * Adding a Drizzle column DEFAULT triggers a `campaigns` table rebuild
     * on D1 (`DROP TABLE campaigns`) which cascade-wipes child rows — see
     * CLAUDE.md "Migration safety on D1". An optional, default-less column
     * generates a plain additive `ALTER TABLE ADD COLUMN`, which is D1-safe.
     * The 30-day fallback lives in the purge cron (`campaign.retentionDays
     * ?? 30`), not in the column DEFAULT.
     */
    retentionDays: z.integer().min(1).max(3_650).optional(),
    /**
     * Sub-columns rendered between "New" and "Completed" on the Kanban board.
     * Only meaningful when `features.kanban` is on. Capped at 5 columns by
     * the controller. Default is a single "In Progress" lane so existing
     * accepted quests keep a coherent column to live in.
     */
    kanbanColumns: db.default(
      z.array(z.string().min(1).max(24)).min(1).max(5),
      ["In Progress"],
    ),
    /**
     * @deprecated — the gold Shop / feature paywall was removed. Every
     * feature it used to sell (Chronicles, Quest Reminder, Quest Gating)
     * is now either always-on or a plain owner toggle. No code reads or
     * writes these two columns.
     *
     * They are kept in the schema ON PURPOSE: dropping a column from
     * `campaigns` risks the Drizzle/D1 table-rebuild path, and `campaigns`
     * is a CASCADE parent of members/quests/chapters/folios/petitions —
     * exactly the shape that wiped production on 2026-05-13. Same
     * treatment as the `public` column above. A future PR can drop them
     * with a hand-written, verified `ALTER TABLE ... DROP COLUMN`.
     */
    unlockedFeatures: db.default(z.array(z.string()), []),
    /** @deprecated — see `unlockedFeatures`. */
    unlockHistory: db.default(
      z.array(
        z.object({
          feature: z.string(),
          characterId: z.integer(),
          price: z.integer().min(0),
          at: z.datetime(),
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

export type Campaign = Infer<typeof campaigns.schema>;
