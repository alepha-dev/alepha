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
  }),
  default: {
    maxCampaignsPerUser: 10,
  },
});

export type CampaignOptions = Static<typeof campaignOptionsAtom.schema>;
