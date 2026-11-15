import { AlephaError } from "alepha";

import type { AutomationRule } from "./automationRuleSchema.ts";

/**
 * A notify action names one or more channels (#Q3613). The engine runs one
 * channel per action, as it always has: {@link expand} turns a rule whose
 * notify actions carry `channels` into one single-channel notify per
 * channel, and that expanded rule is what a run's snapshot holds. Receipts,
 * identities, the delivery cap and the roster stay per action.
 *
 * A stored rule always carries `channels` ({@link normalize}); `channel`
 * alone survives only in run snapshots, expanded, and in snapshots written
 * before #Q3613.
 */
export class AutomationRuleChannels {
  /**
   * The most actions an authored rule may hold. The schema allows more,
   * for the expanded form in a snapshot.
   */
  public static readonly MAX_ACTIONS = 5;
  public static readonly MAX_CHANNELS = 8;

  /**
   * The channels a notify action names.
   */
  public static of(action: AutomationRule["actions"][number]): string[] {
    if (action.kind !== "notify") return [];
    if (action.channels) return [...action.channels];
    return action.channel !== undefined ? [action.channel] : [];
  }

  /**
   * The authored form: every notify carries `channels`, deduplicated.
   */
  public static normalize(rule: AutomationRule): AutomationRule {
    if (rule.actions.length > AutomationRuleChannels.MAX_ACTIONS)
      throw new AlephaError(
        `A rule holds at most ${AutomationRuleChannels.MAX_ACTIONS} actions`,
      );
    return {
      ...rule,
      actions: rule.actions.map((action) => {
        if (action.kind !== "notify") return action;
        const { channel: _channel, ...rest } = action;
        const channels = [...new Set(AutomationRuleChannels.of(action))];
        if (channels.length === 0)
          throw new AlephaError("A notification names at least one channel");
        if (channels.length > AutomationRuleChannels.MAX_CHANNELS)
          throw new AlephaError(
            `A notification names at most ${AutomationRuleChannels.MAX_CHANNELS} channels`,
          );
        return { ...rest, channels };
      }),
    };
  }

  /**
   * The run form: one notify per channel, in order, each with `channel`.
   */
  public static expand(rule: AutomationRule): AutomationRule {
    return {
      ...rule,
      actions: rule.actions.flatMap((action): AutomationRule["actions"] => {
        if (action.kind !== "notify" || !action.channels) return [action];
        const { channels, ...rest } = action;
        return channels.map((channel) => ({ ...rest, channel }));
      }),
    };
  }
}
