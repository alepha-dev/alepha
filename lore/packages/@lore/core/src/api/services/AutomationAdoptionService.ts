import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DbCacheProvider, sql } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, ConflictError, ForbiddenError } from "alepha/server";

import {
  automationAdoptions,
  type AutomationAdoption,
} from "../entities/automationAdoptions.ts";
import { users } from "../entities/users.ts";
import type { AutomationAdoptionBody } from "../schemas/automationAdoptionBodySchema.ts";
import type { AutomationAdoptionPolicy } from "../schemas/automationAdoptionPolicySchema.ts";
import { automationAdoptionPreviewSchema } from "../schemas/automationAdoptionPreviewSchema.ts";
import { AutomationAccess } from "./AutomationAccess.ts";
import { AutomationAdoptionRegistry } from "./AutomationAdoptionRegistry.ts";
import { AutomationAtomic } from "./AutomationAtomic.ts";
import { AutomationBatchRepository } from "./AutomationBatchRepository.ts";
import { AutomationCatalog } from "./AutomationCatalog.ts";
import { AutomationChannels } from "./AutomationChannels.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import { AutomationLegacyQueue } from "./AutomationLegacyQueue.ts";
import { AutomationMutationAudit } from "./AutomationMutationAudit.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";
import { AutomationService } from "./AutomationService.ts";

/**
 * A named caller consents. Disabled preparation is resumable; enable and cutover share one native batch.
 */
export class AutomationAdoptionService {
  protected readonly audit = $inject(AutomationMutationAudit);
  protected readonly users = $repository(users);
  protected readonly access = $inject(AutomationAccess);
  protected readonly registry = $inject(AutomationAdoptionRegistry);
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly service = $inject(AutomationService);
  protected readonly catalog = $inject(AutomationCatalog);
  protected readonly channels = $inject(AutomationChannels);
  protected readonly legacy = $inject(AutomationLegacyQueue);
  protected readonly database = $inject(AutomationDatabase);
  protected readonly atomic = $inject(AutomationAtomic);
  protected readonly rows = $inject(
    AutomationBatchRepository.of(automationAdoptions),
  );
  protected readonly cache = $inject(DbCacheProvider);
  protected readonly time = $inject(DateTimeProvider);

  public async preview(
    projectId: number,
    policy: AutomationAdoptionPolicy,
    user: UserAccountToken,
  ) {
    return this.database.primary(async () => {
      await this.access.authorize(projectId, user, "automation:read");
      const definition = this.registry.get(policy);
      const marker = await this.persistence.adoptions.findOne({
        where: { projectId, policy },
      });
      let candidate;
      let deleted = false;
      if (marker) {
        const stored = await this.persistence.rules.findById(
          marker.automationId,
          { force: true },
        );
        deleted = !!stored?.deletedAt;
        if (stored && !deleted)
          candidate = await this.service.get(projectId, stored.id, user);
      }
      const author = marker
        ? await this.users.getById(marker.authorUserId)
        : await this.users.getById(user.id);
      let reason: string | undefined;
      let details: Awaited<ReturnType<typeof definition.preview>> = {
        recipients: [],
        recipientsHasMore: false,
      };
      try {
        await this.validate(projectId, policy, user);
        details = await definition.preview(projectId, user.id);
      } catch (error) {
        reason =
          error instanceof Error
            ? error.message
            : "Policy adoption is unavailable";
      }
      return automationAdoptionPreviewSchema.parse({
        policy,
        title: definition.title,
        description: definition.description,
        author: {
          id: marker?.authorUserId ?? user.id,
          name: (
            author.username ||
            [author.firstName, author.lastName].filter(Boolean).join(" ") ||
            author.id
          ).slice(0, 255),
        },
        state: !marker
          ? "legacy"
          : marker.state === "pending"
            ? "pending"
            : deleted || !candidate?.enabled
              ? "opted_out"
              : "adopted",
        ...(marker
          ? {
              markerVersion: marker.version,
              replacementId: marker.automationId,
            }
          : {}),
        ...(candidate ? { candidate } : {}),
        rule: candidate?.rule ?? definition.build(),
        ready: !reason && (!marker || marker.authorUserId === user.id),
        ...(reason
          ? { reason }
          : marker && marker.authorUserId !== user.id
            ? {
                reason:
                  "Only the original author may finish or enable this replacement",
              }
            : {}),
        permissions: definition.permissions,
        channels: definition.channels,
        ...details,
      });
    });
  }
  protected async validate(
    projectId: number,
    policy: AutomationAdoptionPolicy,
    user: UserAccountToken,
  ): Promise<void> {
    const context = await this.access.authorize(
      projectId,
      user,
      "automation:write",
    );
    const definition = this.registry.get(policy);
    const missing = definition.permissions.find(
      (permission) => !context.permissions.includes(permission),
    );
    if (missing) throw new ForbiddenError(`Missing ${missing}`);
    if (!this.legacy.available())
      throw new BadRequestError(
        "Atomic legacy enqueue is not installed in this runtime",
      );
    await this.catalog.compile(projectId, user, definition.build());
    const channels = await this.channels.all(projectId);
    if (
      definition.channels.some(
        (key) =>
          !channels.some((channel) => channel.key === key && channel.available),
      )
    )
      throw new BadRequestError("Required policy channels are unavailable");
  }
  public async adopt(
    projectId: number,
    policy: AutomationAdoptionPolicy,
    user: UserAccountToken,
    input: AutomationAdoptionBody,
  ) {
    return this.database.primary(async () => {
      if (input.confirm !== true)
        throw new BadRequestError("Explicit author consent is required");
      await this.validate(projectId, policy, user);
      const definition = this.registry.get(policy);
      let marker = await this.persistence.adoptions.findOne({
        where: { projectId, policy },
      });
      if (marker?.state === "adopted")
        return this.preview(projectId, policy, user);
      if (marker && marker.authorUserId !== user.id)
        throw new ForbiddenError(
          "The pending replacement belongs to another author",
        );
      if (!marker) {
        if (input.automationId) {
          const rule = await this.service.get(
            projectId,
            input.automationId,
            user,
          );
          if (
            !rule.canEdit ||
            rule.authorUserId !== user.id ||
            !rule.rule ||
            !definition.matches(rule.rule)
          )
            throw new ForbiddenError(
              "Choose your own compatible replacement rule",
            );
          if (input.expectedRevision !== rule.revision)
            throw new ConflictError(
              "Replacement revision changed; preview again",
            );
          const now = this.time.nowISOString();
          const id = crypto.randomUUID();
          await this.atomic.guarded(
            projectId,
            sql`NOT EXISTS (SELECT 1 FROM automation_adoptions WHERE project_id = ${projectId} AND policy = ${policy}) AND EXISTS (SELECT 1 FROM automations WHERE id = ${rule.id} AND revision = ${rule.revision} AND author_user_id = ${user.id} AND deleted_at IS NULL)`,
            [
              this.rows.insertStatement({
                id,
                projectId,
                policy,
                automationId: rule.id,
                authorUserId: user.id,
                state: "pending",
                createdAt: now,
                updatedAt: now,
              }),
              this.audit.statement(projectId, user, "adopt", rule.id, {
                policy,
                revision: rule.revision,
              }),
            ],
          );
          await this.cache.invalidateTable("audits");
          await this.audit.activity(projectId, user, "adopt");
        } else {
          await this.service.create(
            projectId,
            user,
            { title: definition.title, rule: definition.build() },
            `compatibility-${policy}`,
            [],
            (rule) => ({
              condition: sql`NOT EXISTS (SELECT 1 FROM automation_adoptions WHERE project_id = ${projectId} AND policy = ${policy})`,
              statements: [
                this.rows.insertStatement({
                  id: crypto.randomUUID(),
                  projectId,
                  policy,
                  automationId: rule.id,
                  authorUserId: user.id,
                  state: "pending",
                  createdAt: rule.createdAt,
                  updatedAt: rule.updatedAt,
                }),
              ],
              changedTables: ["automation_adoptions"],
            }),
          );
        }
        await this.cache.invalidateTable("automation_adoptions");
        marker = await this.persistence.adoptions.getOne({
          where: { projectId, policy },
        });
      }
      const pendingRule = await this.persistence.rules.getById(
        marker.automationId,
        { force: true },
      );
      if (pendingRule.deletedAt && !input.automationId) {
        const previous = marker;
        await this.service.create(
          projectId,
          user,
          { title: definition.title, rule: definition.build() },
          `compatibility-${policy}`,
          [],
          (rule) => ({
            condition: sql`EXISTS (SELECT 1 FROM automation_adoptions WHERE id = ${previous.id} AND version = ${previous.version} AND state = 'pending' AND author_user_id = ${user.id} AND automation_id = ${previous.automationId}) AND EXISTS (SELECT 1 FROM automations WHERE id = ${previous.automationId} AND deleted_at IS NOT NULL)`,
            statements: [
              this.rows.updateStatement(
                {
                  id: previous.id,
                  version: previous.version,
                  state: "pending",
                },
                {
                  automationId: rule.id,
                  version: previous.version + 1,
                  updatedAt: rule.createdAt,
                },
                false,
              ),
            ],
            changedTables: ["automation_adoptions"],
          }),
        );
        marker = await this.persistence.adoptions.getById(previous.id);
      }
      const candidate = await this.service.get(
        projectId,
        marker.automationId,
        user,
      );
      if (!candidate.rule || !definition.matches(candidate.rule))
        throw new ConflictError(
          "Pending replacement no longer preserves this policy",
        );
      if (
        (input.automationId && input.automationId !== marker.automationId) ||
        (input.expectedRevision !== undefined &&
          input.expectedRevision !== candidate.revision)
      )
        throw new ConflictError("Pending replacement changed; preview again");
      await this.cutover(marker, candidate.revision, user);
      return this.preview(projectId, policy, user);
    });
  }
  protected async cutover(
    marker: AutomationAdoption,
    revision: number,
    user: UserAccountToken,
  ): Promise<void> {
    const now = this.time.nowISOString();
    await this.service.setEnabled(
      marker.projectId,
      marker.automationId,
      user,
      true,
      revision,
      {
        adopting: marker.policy,
        condition: sql`EXISTS (SELECT 1 FROM automation_adoptions WHERE id = ${marker.id} AND version = ${marker.version} AND state = 'pending' AND author_user_id = ${user.id})`,
        statements: [
          this.rows.updateStatement(
            { id: marker.id, version: marker.version, state: "pending" },
            { state: "adopted", adoptedAt: now, updatedAt: now },
            false,
          ),
        ],
        changedTables: ["automation_adoptions"],
      },
    );
  }
}
