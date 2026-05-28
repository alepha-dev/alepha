/**
 * Static registry of paywalled features. Each `key` is what we store in
 * `campaigns.unlockedFeatures` once a character sponsors it. Prices come
 * from the calibration in [[Character — vision and economy]] §Pricing.
 *
 * Adding a new feature here makes it sponsorable; it does NOT automatically
 * gate behavior. Wire the gate at the call site (see quest #77).
 */
export interface PaywalledFeature {
  key: string;
  label: string;
  description: string;
  /** Cost in gold (whole units — 1g = 100 silver in the balance ledger). */
  price: number;
}

export class FeatureRegistry {
  protected features: readonly PaywalledFeature[] = [
    {
      key: "quest_reminder",
      label: "Quest Reminder",
      description: "Periodic email reminders for accepted quests.",
      price: 1,
    },
    {
      key: "chronicles",
      label: "Chronicles",
      description:
        "Campaign-wide stats: completion timelines, top zones, leaderboards.",
      price: 1,
    },
    {
      key: "quest_gating",
      label: "Quest Gating",
      description:
        "Soft (recommended) and hard (required) level gating on quests.",
      price: 1,
    },
  ];

  list(): readonly PaywalledFeature[] {
    return this.features;
  }

  get(key: string): PaywalledFeature | undefined {
    return this.features.find((f) => f.key === key);
  }
}
