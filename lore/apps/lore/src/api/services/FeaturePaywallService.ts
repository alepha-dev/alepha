import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { BadRequestError, ForbiddenError } from "alepha/server";
import { campaigns } from "../entities/campaigns.ts";
import { type Character, characters } from "../entities/characters.ts";
import { FeatureRegistry } from "./FeatureRegistry.ts";

/**
 * Single-payer feature unlocks. One character with enough gold pays the
 * full price atomically; the feature is on for the whole campaign
 * permanently. The payer is recorded in `campaigns.unlockHistory`.
 *
 * See folio [[Character — vision and economy]] for the design rationale.
 */
export class FeaturePaywallService {
  protected campaigns = $repository(campaigns);
  protected characters = $repository(characters);
  protected registry = $inject(FeatureRegistry);
  protected dt = $inject(DateTimeProvider);

  /**
   * Whether a feature is unlocked for the given campaign. Caller is
   * expected to have a fresh `Campaign` (re-fetch if you need an
   * up-to-the-millisecond answer).
   */
  isUnlocked(
    unlockedFeatures: readonly string[] | undefined,
    featureKey: string,
  ): boolean {
    return (unlockedFeatures ?? []).includes(featureKey);
  }

  /**
   * Atomically buy a feature for a campaign — Shop transaction.
   *
   * Invariants:
   *  - Feature key must be in the registry.
   *  - The character must belong to the campaign.
   *  - The character's balance must cover the full price.
   *  - The feature must not already be unlocked.
   *
   * On success: debits the character's balance, appends the key to
   * `campaigns.unlockedFeatures`, and records the buyer in
   * `campaigns.unlockHistory`.
   *
   * SQLite serializes writes — wrap the call in `$transactional()` at the
   * controller level to make the read/check/write a single unit. Without
   * it two concurrent buyers could both pass the not-already-unlocked
   * check; the second one's append would still land but it would
   * double-debit. The transactional middleware on the action is the
   * required guard.
   */
  async buy(campaignId: number, character: Character, featureKey: string) {
    const feature = this.registry.get(featureKey);
    if (!feature) {
      throw new BadRequestError(`Unknown feature: ${featureKey}`);
    }

    if (character.campaignId !== campaignId) {
      throw new ForbiddenError("Character does not belong to this campaign");
    }

    const campaign = await this.campaigns.getOne({
      where: { id: { eq: campaignId } },
    });

    if (this.isUnlocked(campaign.unlockedFeatures, featureKey)) {
      throw new BadRequestError(`Feature already unlocked: ${featureKey}`);
    }

    // Price is denominated in gold; balance is the silver ledger
    // (`getGold(balance) = floor(balance/100)`). So compare against
    // `price * 100`.
    const priceInLedger = feature.price * 100;
    if (character.balance < priceInLedger) {
      throw new BadRequestError(
        `Insufficient balance to sponsor ${feature.label} (need ${feature.price}g)`,
      );
    }

    character.balance -= priceInLedger;
    campaign.unlockedFeatures = [
      ...(campaign.unlockedFeatures ?? []),
      feature.key,
    ];
    campaign.unlockHistory = [
      ...(campaign.unlockHistory ?? []),
      {
        feature: feature.key,
        characterId: character.id,
        price: feature.price,
        at: this.dt.nowISOString(),
      },
    ];

    // Hybrid "Shop unlocks AND defaults the toggle ON" pattern: when
    // the bought feature has a matching `campaign.features.questXxx`
    // toggle, flip it ON. Owner can still turn it off in Settings →
    // Features → Quests if they want the chrome hidden for a while.
    const SHOP_FEATURE_TO_TOGGLE: Record<
      string,
      keyof typeof campaign.features
    > = {
      quest_reminder: "questReminder",
      quest_gating: "questGating",
    };
    const toggleKey = SHOP_FEATURE_TO_TOGGLE[feature.key];
    if (toggleKey) {
      campaign.features = {
        ...campaign.features,
        [toggleKey]: true,
      };
    }

    await Promise.all([
      this.characters.save(character),
      this.campaigns.save(campaign),
    ]);

    return { campaign, character, feature };
  }
}
