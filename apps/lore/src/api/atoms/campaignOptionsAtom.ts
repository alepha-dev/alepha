import { $atom, type Static, t } from "alepha";

/**
 * Tunable limits for campaigns. Held as an atom so tests and ops can override
 * via `alepha.store.set(campaignOptionsAtom, { ... })` without touching code.
 */
export const campaignOptionsAtom = $atom({
  name: "lore.campaign.options",
  description: "Per-user limits for campaigns",
  schema: t.object({
    /**
     * Max campaigns a single user can own. Members of campaigns owned by
     * other users are not counted against this limit.
     */
    maxCampaignsPerUser: t.integer({ minimum: 1, default: 10 }),
    /**
     * Number of most-recent campaigns surfaced on the Home page.
     */
    homeRecentLimit: t.integer({ minimum: 1, maximum: 50, default: 5 }),
  }),
  default: {
    maxCampaignsPerUser: 10,
    homeRecentLimit: 5,
  },
});

export type CampaignOptions = Static<typeof campaignOptionsAtom.schema>;
