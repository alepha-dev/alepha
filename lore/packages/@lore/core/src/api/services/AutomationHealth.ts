import { $hook, $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { HttpError } from "alepha/server";

import type { Automation } from "../entities/automations.ts";
import { AutomationGraph } from "../schemas/AutomationGraph.ts";
import { AutomationAccess } from "./AutomationAccess.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import {
  AutomationDependencies,
  type AutomationDependencyCheck,
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
 *
 * ⚠️ Only a REFUSAL is a verdict on a rule (#Q3267). `inspect` used to read
 * every error its checks threw as "the author must review this rule", so a
 * D1 timeout while reading the author paused a healthy rule, demanded an
 * approval nobody could explain, and printed the timed-out SQL as the reason
 * a member read. A failure to CHECK says nothing about the rule: it is
 * rethrown, the rule stays as it was, and the next sweep asks again.
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
  protected readonly graphs = $inject(AutomationGraph);

  public display(rule: Pick<Automation, "enabled" | "health">) {
    return rule.enabled ? rule.health : ("disabled" as const);
  }
  public async inspect(
    rule: Automation,
    explicit = false,
    checked?: AutomationDependencyCheck,
  ): Promise<AutomationHealthDecision> {
    if (rule.requiresApproval && !explicit && !this.pausedByFailure(rule))
      return {
        health: "paused",
        requiresApproval: true,
        reason: rule.reason ?? "Author review is required",
      };
    try {
      await this.dependencies.assert(rule, checked?.sources);
      const user = await this.access.author(rule);
      await this.access.assert(rule.projectId, user, "automation:write", rule);
      const values = await this.variables.snapshot(rule, user, {
        transition: false,
        checked,
      });
      if (!explicit) this.variables.assertApproved(rule, values);
      return { health: "active", requiresApproval: false };
    } catch (error) {
      if (error instanceof AutomationDependencyError)
        return {
          health: "broken",
          requiresApproval: false,
          reason: error.message.slice(0, 1024),
        };
      if (this.refusal(error))
        return {
          health: "paused",
          requiresApproval: true,
          reason: error.message.slice(0, 1024),
        };
      throw error;
    }
  }

  /**
   * Whether a check REFUSED the rule, as opposed to failing to run.
   *
   * Every refusal the checks above make is a 4xx `HttpError` (the author is
   * gone or lost a permission, a variable changed hands or is no longer
   * approved). Anything else is the check itself failing: a database
   * timeout, a driver error, a bug.
   */
  protected refusal(error: unknown): error is HttpError {
    return (
      error instanceof HttpError && error.status >= 400 && error.status < 500
    );
  }

  /**
   * A rule the old `inspect` paused over a failure to check, recognised by
   * the driver's sentence it stored as the reason.
   *
   * Such a rule was never refused, so its pause is not a security review and
   * does not survive reconciliation: it is inspected again in full, which
   * pauses it again, with a real reason, if it does need its author.
   */
  protected pausedByFailure(rule: Pick<Automation, "reason">): boolean {
    return AutomationHealth.FAILURE_REASON.test(rule.reason ?? "");
  }

  /**
   * What a database failure reads like once stored as a reason: the D1
   * timeout's own prefix, a statement over quoted columns, or a driver's
   * error code. Narrow on purpose: a reason it matches by accident loses its
   * review, so it names what only a driver writes.
   */
  protected static readonly FAILURE_REASON =
    /^D1 query timed out|\bselect\s+"|\bSQLITE_|\bD1_ERROR\b/i;
  public async reconcile(rule: Automation): Promise<void> {
    return this.database.primary(async () => {
      // A check that could not run throws out of here, before anything is
      // written: not even `healthCheckedAt`, so the sweep takes this rule
      // first next time.
      // Each source's own health (#Q3806), outside the rule: a write here
      // never bumps the revision. A change names the sources that moved.
      // Computed once and handed to `inspect`, whose dependency check reads
      // the same capabilities, channels and variables (#Q3827).
      const checked = await this.dependencies.check(rule);
      const sources = checked.sources;
      const decision = await this.inspect(rule, false, checked);
      // A source never judged was active: filling it in moves nothing.
      const moved = Object.entries(sources).filter(
        ([id, value]) =>
          (rule.sourceHealth?.[id]?.health ?? "active") !== value.health,
      );
      const partly = Object.entries(sources).find(
        ([id, value]) =>
          value.health === "broken" &&
          this.graphs.node(rule.rule, id)?.enabled !== false,
      );
      const reason =
        decision.health === "active" && partly
          ? `source '${partly[0]}' cannot run: ${partly[1].reason}`.slice(
              0,
              1024,
            )
          : decision.reason;
      await this.evidence.transition(
        rule.id,
        decision.health,
        reason,
        decision.requiresApproval,
        {
          expectedVersion: rule.version,
          notifyAuthor: true,
          ...(moved.length ? { patch: { sourceHealth: sources } } : {}),
        },
      );
      const latest = await this.persistence.rules.getById(rule.id);
      await this.persistence.rules.updateMany(
        { id: rule.id, version: latest.version },
        {
          healthCheckedAt: this.time.nowMillis(),
          // Bookkeeping, no record: what no source's move changed.
          ...(JSON.stringify(latest.sourceHealth ?? null) !==
          JSON.stringify(sources)
            ? { sourceHealth: sources }
            : {}),
        },
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
  /**
   * How long a rule's health stands before the sweep checks it again.
   *
   * The sweep is a safety net, not the propagation (#Q3827): a capability
   * change revalidates its project at once (`ProjectCapabilityController`),
   * so does a channel's removal, and every effect checks its author's
   * authority again, uncached, right before it runs (`AutomationAuthority`).
   * Re-checking every rule every five minutes cost about 75 statements per
   * rule per tick on D1, whether or not anything had changed. A check that
   * could not run stamps nothing, so that rule is still retried each tick.
   */
  public static readonly RECHECK_AFTER_MS = 60 * 60 * 1000;

  public async sweep(limit = 50): Promise<number> {
    return this.database.primary(async () => {
      const rows = await this.persistence.rules.findMany({
        where: {
          healthCheckedAt: {
            lt: this.time.nowMillis() - AutomationHealth.RECHECK_AFTER_MS,
          },
        },
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
