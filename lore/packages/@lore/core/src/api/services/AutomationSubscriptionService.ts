import { $inject } from "alepha";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError } from "alepha/server";

import type { Automation } from "../entities/automations.ts";
import type { AutomationSubscription } from "../schemas/automationSubscriptionSchema.ts";
import type { AutomationSubscriptionSetBody } from "../schemas/automationSubscriptionSetBodySchema.ts";
import { AutomationAccess } from "./AutomationAccess.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import { AutomationPresetService } from "./AutomationPresetService.ts";
import { AutomationService } from "./AutomationService.ts";

/**
 * "My subscription" to a preset, in one project: a toggle (the feedback
 * page's bell) that turns a stock preset into a rule notifying its viewer,
 * and finds that rule again (#Q3576).
 *
 * - **The marker** is the rule's `subscription` flag, with its `presetKey`
 *   and its author. A rule the toggle made stays an ordinary rule: listed,
 *   editable, and deletable from the automations pages.
 * - **On** creates the rule from the preset, enabled in the same write, with
 *   the caller as recipient. Already on, it changes nothing.
 * - **Off** deletes every rule the caller's toggle made from that preset,
 *   enabled or not, so a rule disabled by hand does not linger behind it.
 * - **The state** is server-side: subscribed means the caller owns an
 *   enabled marked rule. One they disabled from the automations page reads
 *   as off, and turning the toggle on again replaces it.
 */
export class AutomationSubscriptionService {
  protected readonly access = $inject(AutomationAccess);
  protected readonly database = $inject(AutomationDatabase);
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly presets = $inject(AutomationPresetService);
  protected readonly service = $inject(AutomationService);

  public async get(
    projectId: number,
    user: UserAccountToken,
    key: string,
  ): Promise<AutomationSubscription> {
    await this.access.assert(projectId, user, "automation:read");
    return this.state(await this.marked(projectId, user, key));
  }

  public async set(
    projectId: number,
    user: UserAccountToken,
    key: string,
    body: AutomationSubscriptionSetBody,
  ): Promise<AutomationSubscription> {
    await this.access.assert(projectId, user, "automation:write");
    const rules = await this.marked(projectId, user, key);
    if (body.subscribed) {
      if (rules.some((rule) => rule.enabled)) return this.state(rules);
      if (body.values && "recipient" in body.values)
        throw new BadRequestError(
          "setup.recipient: a subscription always notifies its caller",
        );
      // A marked rule disabled by hand is replaced, not kept beside it.
      await this.remove(projectId, user, rules);
      await this.presets.create(
        projectId,
        user,
        {
          key,
          values: { ...body.values, recipient: user.id },
          enabled: true,
        },
        { subscription: true },
      );
    } else await this.remove(projectId, user, rules);
    return this.state(await this.marked(projectId, user, key));
  }

  protected async remove(
    projectId: number,
    user: UserAccountToken,
    rules: Automation[],
  ) {
    for (const rule of rules)
      await this.service.remove(projectId, rule.id, user, rule.revision);
  }

  protected marked(projectId: number, user: UserAccountToken, key: string) {
    return this.database.primary(() =>
      this.persistence.rules.findMany({
        where: {
          projectId,
          authorUserId: user.id,
          presetKey: key,
          subscription: true,
        },
        orderBy: [{ column: "createdAt", direction: "desc" }],
        limit: 16,
      }),
    );
  }

  protected state(rules: Automation[]): AutomationSubscription {
    const rule = rules.find((candidate) => candidate.enabled);
    if (!rule) return { subscribed: false };
    const notify = rule.rule.actions.find((action) => action.kind === "notify");
    return {
      subscribed: true,
      automationId: rule.id,
      ...(notify && "channel" in notify ? { channel: notify.channel } : {}),
    };
  }
}
