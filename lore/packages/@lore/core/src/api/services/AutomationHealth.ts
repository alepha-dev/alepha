import { $hook, $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import type { Automation } from "../entities/automations.ts";
import { AutomationAccess } from "./AutomationAccess.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import {
  AutomationDependencies,
  AutomationDependencyError,
} from "./AutomationDependencies.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import { AutomationProjectSecurity } from "./AutomationProjectSecurity.ts";
import { AutomationRunEvidence } from "./AutomationRunEvidence.ts";
import { AutomationVariables } from "./AutomationVariables.ts";
import { BestEffort } from "./BestEffort.ts";

/**
 * Enable intent is explicit. Dependency recovery may restore health, while a
 * security review survives reconciliation and requires a valid author action.
 */
export class AutomationHealth {
  protected readonly database = $inject(AutomationDatabase);
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly dependencies = $inject(AutomationDependencies);
  protected readonly access = $inject(AutomationAccess);
  protected readonly variables = $inject(AutomationVariables);
  protected readonly evidence = $inject(AutomationRunEvidence);
  protected readonly security = $inject(AutomationProjectSecurity);
  protected readonly bestEffort = $inject(BestEffort);
  protected readonly time = $inject(DateTimeProvider);

  public display(rule: Pick<Automation, "enabled" | "health">) {
    return rule.enabled ? rule.health : ("disabled" as const);
  }
  public async inspect(
    rule: Automation,
    explicit = false,
  ): Promise<AutomationHealthDecision> {
    if (rule.requiresApproval && !explicit)
      return {
        health: "paused",
        requiresApproval: true,
        reason: rule.reason ?? "Author review is required",
      };
    try {
      await this.dependencies.assert(rule);
      const user = await this.access.author(rule);
      await this.access.assert(rule.projectId, user, "automation:write");
      const values = await this.variables.snapshot(rule, user, {
        transition: false,
      });
      if (!explicit) this.variables.assertApproved(rule, values);
      return { health: "active", requiresApproval: false };
    } catch (error) {
      return {
        health:
          error instanceof AutomationDependencyError ? "broken" : "paused",
        requiresApproval: !(error instanceof AutomationDependencyError),
        reason: (error instanceof Error
          ? error.message
          : "Automation validation failed"
        ).slice(0, 1024),
      };
    }
  }
  public async reconcile(rule: Automation): Promise<void> {
    return this.database.primary(async () => {
      const decision = await this.inspect(rule);
      await this.evidence.transition(
        rule.id,
        decision.health,
        decision.reason,
        decision.requiresApproval,
        { expectedVersion: rule.version },
      );
      const latest = await this.persistence.rules.getById(rule.id);
      await this.persistence.rules.updateMany(
        { id: rule.id, version: latest.version },
        { healthCheckedAt: this.time.nowMillis() },
      );
    });
  }
  public async project(projectId: number): Promise<number> {
    return this.database.primary(async () => {
      let cursor: string | undefined;
      let count = 0;
      for (;;) {
        const rows = await this.persistence.rules.findMany({
          where: { projectId, ...(cursor ? { id: { gt: cursor } } : {}) },
          orderBy: "id",
          limit: 50,
        });
        for (const rule of rows)
          await this.bestEffort.run("Revalidate automation health", () =>
            this.reconcile(rule),
          );
        count += rows.length;
        if (rows.length < 50) return count;
        cursor = rows[rows.length - 1].id;
      }
    });
  }
  public async sweep(limit = 50): Promise<number> {
    return this.database.primary(async () => {
      const rows = await this.persistence.rules.findMany({
        where: {},
        orderBy: [
          { column: "healthCheckedAt", direction: "asc" },
          { column: "id", direction: "asc" },
        ],
        limit: Math.min(50, limit),
      });
      for (const rule of rows)
        await this.bestEffort.run("Revalidate automation health", () =>
          this.reconcile(rule),
        );
      return rows.length;
    });
  }
  protected readonly memberRemoved = $hook({
    on: "organization:member:removed",
    handler: async ({ organizationId, userId }) => {
      await this.bestEffort.run("Pause automations after author removal", () =>
        this.database.primary(async () => {
          const projects = await this.security.projects.findMany({
            where: { organizationId },
            limit: 50,
          });
          for (const project of projects) {
            let cursor: string | undefined;
            for (;;) {
              const rules = await this.persistence.rules.findMany({
                where: {
                  projectId: project.id,
                  authorUserId: userId,
                  ...(cursor ? { id: { gt: cursor } } : {}),
                },
                orderBy: "id",
                limit: 50,
              });
              for (const rule of rules)
                await this.evidence.transition(
                  rule.id,
                  "paused",
                  "Author is no longer a project member",
                  true,
                  { expectedVersion: rule.version },
                );
              if (rules.length < 50) break;
              cursor = rules[rules.length - 1].id;
            }
          }
        }),
      );
    },
  });
}
export interface AutomationHealthDecision {
  health: Automation["health"];
  reason?: string;
  requiresApproval: boolean;
}
