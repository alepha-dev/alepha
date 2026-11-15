import { $inject } from "alepha";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError } from "alepha/server";

import type { Automation } from "../entities/automations.ts";
import type { AutomationSubscription } from "../schemas/automationSubscriptionSchema.ts";
import { AutomationSubscriptionScope } from "../schemas/AutomationSubscriptionScope.ts";
import type { AutomationSubscriptionSetBody } from "../schemas/automationSubscriptionSetBodySchema.ts";
import { AutomationAccess } from "./AutomationAccess.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import { AutomationPresetService } from "./AutomationPresetService.ts";
import { AutomationService } from "./AutomationService.ts";

/**
 * "My subscription", in one project: a toggle (a bell) that turns one or
 * more stock presets into rules notifying its viewer, and finds those rules
 * again (#Q3576).
 *
 * - **The marker** is the rule's `subscription` flag, with its `presetKey`,
 *   its author and its `subscriptionScope` (#Q3635). A toggle is identified
 *   by its author, the presets it names and its scope: the bells of two
 *   monitors on the same presets differ by scope, and a list's bell (empty
 *   scope) shares no state with either. A rule the toggle made stays an
 *   ordinary rule: listed, editable, and deletable from the automations
 *   pages.
 * - **On** creates one rule per preset and channel, enabled in the same
 *   write, with the caller as recipient and the scope's values bound. Already
 *   on with the same channels, it changes nothing.
 * - **Off** deletes every rule the toggle made, enabled or not, so a rule
 *   disabled by hand does not linger behind it.
 * - **The state** is server-side: subscribed means the caller owns an
 *   enabled marked rule from each named preset in that scope. One they
 *   disabled from the automations page reads as off, and turning the toggle
 *   on again replaces it.
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
    presets: string[],
    scope: string,
  ): Promise<AutomationSubscription> {
    await this.access.assert(projectId, user, "automation:read");
    const keys = this.keys(presets);
    // Parsed for its refusal only: a malformed scope names no toggle.
    try {
      AutomationSubscriptionScope.decode(scope);
    } catch {
      throw new BadRequestError("scope: malformed subscription scope");
    }
    return this.state(keys, await this.marked(projectId, user, keys, scope));
  }

  public async set(
    projectId: number,
    user: UserAccountToken,
    body: AutomationSubscriptionSetBody,
  ): Promise<AutomationSubscription> {
    await this.access.assert(projectId, user, "automation:write");
    const keys = this.keys(body.presets);
    const bound = body.scope ?? {};
    let scope: string;
    try {
      scope = AutomationSubscriptionScope.encode(bound);
    } catch {
      throw new BadRequestError("scope: at most 255 characters");
    }
    const rules = await this.marked(projectId, user, keys, scope);
    if (body.subscribed) {
      if (body.values && "recipient" in body.values)
        throw new BadRequestError(
          "setup.recipient: a subscription always notifies its caller",
        );
      for (const name of Object.keys(bound))
        if (body.values && name in body.values)
          throw new BadRequestError(
            `setup.${name}: bound by the subscription's scope`,
          );
      const wanted = body.channels ? [...new Set(body.channels)] : undefined;
      const live = this.state(keys, rules);
      // Already on: kept as it is, unless the caller names another set of
      // channels (#Q3602), which replaces the rules.
      if (
        live.subscribed &&
        (!wanted ||
          (wanted.length === live.channels?.length &&
            wanted.every((channel) => live.channels?.includes(channel))))
      )
        return live;
      // A marked rule disabled by hand is replaced, not kept beside it.
      await this.remove(projectId, user, rules);
      // One rule per preset and channel: a preset notifies on one channel,
      // and separate rules keep each of them an ordinary rule its author can
      // read.
      for (const key of keys)
        for (const channel of wanted ?? [undefined])
          await this.presets.create(
            projectId,
            user,
            {
              key,
              values: {
                ...body.values,
                ...bound,
                ...(channel ? { channel } : {}),
                recipient: user.id,
              },
              enabled: true,
            },
            { subscription: true, subscriptionScope: scope },
          );
    } else await this.remove(projectId, user, rules);
    return this.state(keys, await this.marked(projectId, user, keys, scope));
  }

  protected keys(presets: string[]): string[] {
    const keys = [...new Set(presets.map((key) => key.trim()))].filter(Boolean);
    if (keys.length === 0 || keys.length > 8)
      throw new BadRequestError("presets: between one and eight preset keys");
    return keys.sort();
  }

  protected async remove(
    projectId: number,
    user: UserAccountToken,
    rules: Automation[],
  ) {
    for (const rule of rules)
      await this.service.remove(projectId, rule.id, user, rule.revision);
  }

  protected marked(
    projectId: number,
    user: UserAccountToken,
    keys: string[],
    scope: string,
  ) {
    return this.database.primary(() =>
      this.persistence.rules.findMany({
        where: {
          projectId,
          authorUserId: user.id,
          presetKey: { inArray: keys },
          subscription: true,
          subscriptionScope: scope,
        },
        orderBy: [{ column: "createdAt", direction: "desc" }],
        limit: 64,
      }),
    );
  }

  protected state(keys: string[], rules: Automation[]): AutomationSubscription {
    const enabled = rules.filter((candidate) => candidate.enabled);
    // Every preset the toggle names must still have its rule: one deleted or
    // disabled from the automations page reads as off.
    if (
      enabled.length === 0 ||
      !keys.every((key) => enabled.some((rule) => rule.presetKey === key))
    )
      return { subscribed: false };
    const channels = [
      ...new Set(
        enabled.flatMap((candidate) =>
          candidate.rule.actions.flatMap((action) =>
            action.kind === "notify" && "channel" in action
              ? [String(action.channel)]
              : [],
          ),
        ),
      ),
    ].sort();
    return {
      subscribed: true,
      automationId: enabled[0].id,
      ...(channels.length ? { channel: channels[0], channels } : {}),
    };
  }
}
