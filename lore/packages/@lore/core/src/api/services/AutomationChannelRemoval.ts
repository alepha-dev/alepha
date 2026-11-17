import { $inject } from "alepha";

import { AutomationGraph } from "../schemas/AutomationGraph.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import { AutomationHealth } from "./AutomationHealth.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";

/**
 * Removing a configured channel is not a failure (#Q3613, owner answer 13):
 * it leaves every rule of the project that notified it, and each keeps
 * notifying on its other channels, unpaused. A rule left with no channel at
 * all can send nothing, so its health re-check marks it broken.
 *
 * Not a configuration edit: the author's rule keeps its revision, since what
 * it may do only shrank.
 */
export class AutomationChannelRemoval {
  protected readonly database = $inject(AutomationDatabase);
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly health = $inject(AutomationHealth);
  protected readonly graphs = $inject(AutomationGraph);

  /**
   * Remove `channelId` from every rule of the project. Returns how many
   * rules changed.
   */
  public async remove(projectId: number, channelId: string): Promise<number> {
    return this.database.primary(async () => {
      const rules = await this.persistence.rules.findMany({
        where: { projectId },
        limit: 1000,
      });
      let changed = 0;
      for (const rule of rules) {
        if (
          !rule.rule.nodes.some((node) =>
            this.graphs.channels(node).includes(channelId),
          )
        )
          continue;
        await this.persistence.rules.updateById(rule.id, {
          rule: {
            ...rule.rule,
            nodes: rule.rule.nodes.map((node) => {
              if (!this.graphs.channels(node).length) return node;
              const { channel: _channel, ...config } = node.config;
              return {
                ...node,
                config: {
                  ...config,
                  channels: this.graphs
                    .channels(node)
                    .filter((id) => id !== channelId),
                },
              };
            }),
          },
        });
        changed++;
      }
      if (changed) await this.health.project(projectId);
      return changed;
    });
  }
}
