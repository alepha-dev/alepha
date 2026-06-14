import { $repository } from "alepha/orm";
import {
  type BlightIgnoreRule,
  blightIgnoreRules,
} from "../entities/blightIgnoreRules.ts";

/**
 * Owns the campaign-wide blight ignore rules — the substrings that, when
 * matched against an incoming crash's `message`, drop the event at ingestion.
 *
 * Declaring `$repository(blightIgnoreRules)` here registers the
 * `blight_ignore_rules` table in the ORM/migration graph (the migration
 * generator scans instantiated repositories — same pattern as
 * {@link BlightIngestService}).
 *
 * Two consumers:
 * - {@link SigilIngestRunner} — calls {@link listForCampaign} once per batch
 *   then {@link matches} per error to drop muted messages before they are
 *   recorded.
 * - `BlightController` — owner CRUD over the rule list.
 */
export class BlightRuleService {
  protected rules = $repository(blightIgnoreRules);

  /**
   * Every ignore rule for a campaign, newest first.
   */
  async listForCampaign(campaignId: number): Promise<BlightIgnoreRule[]> {
    return this.rules.findMany({
      where: { campaignId: { eq: campaignId } },
      orderBy: [{ column: "createdAt", direction: "desc" }],
    });
  }

  /**
   * Whether `message` matches any rule — case-insensitive substring. A blank
   * message can never match (an empty pattern is rejected at the schema, so
   * the rule list never carries one). Pure: takes the already-loaded rules so
   * the caller controls how often the DB is hit.
   */
  matches(message: string, rules: BlightIgnoreRule[]): boolean {
    if (!message) {
      return false;
    }
    const haystack = message.toLowerCase();
    return rules.some((rule) => haystack.includes(rule.pattern.toLowerCase()));
  }

  /**
   * Add a rule for a campaign. The `pattern` is trimmed by the caller; the
   * column's `minLength` guards against an empty value.
   */
  async create(
    campaignId: number,
    pattern: string,
    userId: string,
  ): Promise<BlightIgnoreRule> {
    return this.rules.create({
      campaignId,
      pattern,
      createdBy: userId,
    });
  }

  /**
   * Delete a rule, asserting it belongs to the expected campaign. Returns
   * `false` when the rule does not exist (or belongs to another campaign) so
   * the controller can map that to a 404 without leaking cross-campaign rows.
   */
  async deleteForCampaign(
    campaignId: number,
    ruleId: number,
  ): Promise<boolean> {
    const rule = await this.rules.findOne({
      where: { id: { eq: ruleId }, campaignId: { eq: campaignId } },
    });
    if (!rule) {
      return false;
    }
    await this.rules.deleteById(rule.id);
    return true;
  }
}
