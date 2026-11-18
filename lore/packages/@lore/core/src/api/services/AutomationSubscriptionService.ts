import { $inject } from "alepha";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError } from "alepha/server";

import type { Automation } from "../entities/automations.ts";
import { AutomationGraph } from "../schemas/AutomationGraph.ts";
import type { AutomationGraphValue } from "../schemas/automationGraphSchema.ts";
import type { AutomationSubscription } from "../schemas/automationSubscriptionSchema.ts";
import { AutomationSubscriptionScope } from "../schemas/AutomationSubscriptionScope.ts";
import type { AutomationSubscriptionSetBody } from "../schemas/automationSubscriptionSetBodySchema.ts";
import { AutomationAccess } from "./AutomationAccess.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import { AutomationPresetRegistry } from "./AutomationPresetRegistry.ts";
import { AutomationPresetService } from "./AutomationPresetService.ts";
import { AutomationService } from "./AutomationService.ts";

/**
 * "My subscription", in one project: a toggle (a bell) that turns one or
 * more stock presets into ONE automation notifying its viewer (#Q3808), and
 * finds it again. Folio #F1501 describes it.
 *
 * - **The marker** is the automation's `subscription` flag, its author, its
 *   `subscriptionScope` (#Q3635) and its `presetKey`, the canonical key of
 *   the presets the toggle names (sorted, `+`-joined).
 * - **On** builds one graph: each preset contributes its source and its
 *   notification, prefixed with its key (`host-offline.source`), every
 *   notification on the chosen channels, the caller as recipient, the
 *   scope's values bound on each source.
 * - **Changing channels or events edits it in place** (one revision) and
 *   touches only the nodes the bell made; what its author added in the
 *   editor stays. Every bell write goes through here, under the
 *   self-subscription gate: a member may hold a bell without
 *   `automation:write`.
 * - **Off** deletes the whole automation.
 * - **The state**: subscribed when the automation is on and so is every
 *   event; partly on when some events are off.
 */
export class AutomationSubscriptionService {
  protected readonly graphs = $inject(AutomationGraph);
  protected readonly access = $inject(AutomationAccess);
  protected readonly database = $inject(AutomationDatabase);
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly presets = $inject(AutomationPresetService);
  protected readonly service = $inject(AutomationService);
  protected readonly registry = $inject(AutomationPresetRegistry);

  public async get(
    projectId: number,
    user: UserAccountToken,
    presets: string[],
    scope: string,
  ): Promise<AutomationSubscription> {
    await this.access.assert(projectId, user, "automation:read", {
      subscription: true,
    });
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
    await this.access.assert(projectId, user, "automation:write", {
      subscription: true,
    });
    const keys = this.keys(body.presets);
    const bound = body.scope ?? {};
    let scope: string;
    try {
      scope = AutomationSubscriptionScope.encode(bound);
    } catch {
      throw new BadRequestError("scope: at most 255 characters");
    }
    const rule = await this.marked(projectId, user, keys, scope);
    if (!body.subscribed) {
      // Off deletes the whole automation, nodes added in the editor too.
      if (rule)
        await this.service.remove(projectId, rule.id, user, rule.revision);
      return this.state(keys, undefined);
    }
    if (body.values && "recipient" in body.values)
      throw new BadRequestError(
        "setup.recipient: a subscription always notifies its caller",
      );
    for (const name of Object.keys(bound))
      if (body.values && name in body.values)
        throw new BadRequestError(
          `setup.${name}: bound by the subscription's scope`,
        );
    const events = new Set(body.events ?? keys);
    for (const event of events)
      if (!keys.includes(event))
        throw new BadRequestError(`events: '${event}' is not one of presets`);
    const wanted = body.channels ? [...new Set(body.channels)] : undefined;
    const values = {
      ...body.values,
      ...bound,
      ...(wanted ? { channel: wanted[0] } : {}),
      recipient: user.id,
    };
    if (!rule) {
      await this.presets.createMerged(
        projectId,
        user,
        {
          keys,
          key: this.key(keys),
          values,
          title: body.title,
          enabled: true,
          edit: (graph) => this.shape(graph, keys, events, wanted),
        },
        { subscription: true, subscriptionScope: scope },
      );
      return this.state(keys, await this.marked(projectId, user, keys, scope));
    }
    // Already there: edited in place, one revision, touching only the
    // nodes the bell made (#Q3808). A bell source deleted by hand and
    // ticked again is put back.
    let graph = rule.rule;
    const missing = keys.filter(
      (key) =>
        events.has(key) &&
        !graph.nodes.some((node) => node.id === `${key}.source`),
    );
    if (missing.length) {
      const added = this.registry.merge(
        missing.map((key) => ({ key, values })),
      ).rule;
      const below =
        Math.max(0, ...graph.nodes.map((node) => node.position?.y ?? 0)) +
        AutomationGraph.ROW_HEIGHT;
      graph = {
        ...graph,
        nodes: [
          ...graph.nodes,
          ...added.nodes.map((node) => ({
            ...node,
            position: {
              x: node.position?.x ?? 0,
              y: (node.position?.y ?? 0) + below,
            },
          })),
        ],
        edges: [...graph.edges, ...added.edges],
      };
    }
    graph = this.shape(graph, keys, events, wanted);
    let current = rule;
    if (JSON.stringify(graph) !== JSON.stringify(rule.rule)) {
      await this.service.update(
        projectId,
        rule.id,
        user,
        rule.revision,
        { title: rule.title, rule: graph },
        { subscription: true },
      );
      current = await this.persistence.rules.getById(rule.id);
    }
    if (!current.enabled)
      await this.service.setEnabled(
        projectId,
        rule.id,
        user,
        true,
        current.revision,
      );
    return this.state(keys, await this.marked(projectId, user, keys, scope));
  }

  /**
   * The canonical key of a toggle's presets (#Q3808): sorted, joined by
   * `+`. The automation's `presetKey`, at most 128 characters.
   */
  protected key(keys: string[]): string {
    return keys.join("+");
  }

  protected keys(presets: string[]): string[] {
    const keys = [...new Set(presets.map((key) => key.trim()))].filter(Boolean);
    if (keys.length === 0 || keys.length > 8)
      throw new BadRequestError("presets: between one and eight preset keys");
    keys.sort();
    if (this.key(keys).length > 128)
      throw new BadRequestError(
        "presets: their joined key is longer than 128 characters",
      );
    return keys;
  }

  /**
   * The bell's own nodes, set from what it was asked: each event's source
   * on or off, every notification on the chosen channels. Nodes it did not
   * make are left as they are.
   */
  protected shape(
    graph: AutomationGraphValue,
    keys: string[],
    events: Set<string>,
    channels?: string[],
  ): AutomationGraphValue {
    return {
      ...graph,
      nodes: graph.nodes.map((node) => {
        const key = keys.find((item) => node.id.startsWith(`${item}.`));
        if (!key) return node;
        if (node.kind === "source") {
          const { enabled: _enabled, ...rest } = node;
          return events.has(key) ? rest : { ...rest, enabled: false };
        }
        const current = this.graphs.channels(node);
        // The same channels in another order are the same channels.
        if (
          channels &&
          current.length &&
          (current.length !== channels.length ||
            !channels.every((channel) => current.includes(channel)))
        ) {
          const { channel: _channel, ...config } = node.config;
          return { ...node, config: { ...config, channels } };
        }
        return node;
      }),
    };
  }

  protected async marked(
    projectId: number,
    user: UserAccountToken,
    keys: string[],
    scope: string,
  ): Promise<Automation | undefined> {
    const [rule] = await this.database.primary(() =>
      this.persistence.rules.findMany({
        where: {
          projectId,
          authorUserId: user.id,
          presetKey: this.key(keys),
          subscription: true,
          subscriptionScope: scope,
        },
        orderBy: [{ column: "createdAt", direction: "desc" }],
        limit: 1,
      }),
    );
    return rule;
  }

  protected state(
    keys: string[],
    rule: Automation | undefined,
  ): AutomationSubscription {
    const titles = new Map(
      this.registry.all().map((preset) => [preset.key, preset.title]),
    );
    const events = keys.map((key) => {
      const node = rule?.rule.nodes.find((item) => item.id === `${key}.source`);
      return {
        preset: key,
        title: titles.get(key) ?? key,
        node: `${key}.source`,
        enabled: !!rule?.enabled && !!node && node.enabled !== false,
      };
    });
    if (!rule)
      return { subscribed: false, partial: false, events, additions: false };
    const own = rule.rule.nodes.filter((node) =>
      keys.some((key) => node.id.startsWith(`${key}.`)),
    );
    const channels = [
      ...new Set(own.flatMap((node) => this.graphs.channels(node))),
    ].sort();
    const on = events.filter((event) => event.enabled).length;
    return {
      subscribed: rule.enabled && on === events.length,
      partial: rule.enabled && on > 0 && on < events.length,
      automationId: rule.id,
      revision: rule.revision,
      ...(channels.length ? { channels } : {}),
      events,
      additions: own.length < rule.rule.nodes.length,
    };
  }
}
