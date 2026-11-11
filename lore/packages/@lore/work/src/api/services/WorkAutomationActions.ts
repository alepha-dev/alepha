import {
  AutomationAccess,
  AutomationDomainActions,
  type AutomationDomainHandler,
  type AutomationMutationState,
} from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { $inject, Alepha } from "alepha";
import { $repository, sql } from "alepha/orm";
import { BadRequestError, ConflictError, ForbiddenError } from "alepha/server";

import { QuestController } from "../controllers/QuestController.ts";
import { normalizeQuestTags, quests } from "../entities/quests.ts";
import { releases } from "../entities/releases.ts";
import { questCreateSchema } from "../schemas/questCreateSchema.ts";
import { QuestEditAccess } from "./QuestEditAccess.ts";
import { QuestService } from "./QuestService.ts";

/**
 * Normal quest actions retain the plan/release freeze, ownership, history,
 * attachment validation and default assignment rules. The native root seam
 * only changes their commit boundary.
 */
export class WorkAutomationActions {
  protected readonly alepha = $inject(Alepha);
  protected readonly registry = $inject(AutomationDomainActions);
  protected readonly quests = $repository(quests);
  protected readonly releases = $repository(releases);
  protected readonly projects = $repository(projects);
  protected readonly edit = $inject(QuestEditAccess);
  protected readonly service = $inject(QuestService);
  protected readonly access = $inject(AutomationAccess);

  /**
   * Resolved on use, never held as a field: a field would make `QuestController`
   * injected by a boot service, so it could never be a pure controller
   * created on its first request (#Q3399).
   */
  protected api(): QuestController {
    return this.alepha.inject(QuestController);
  }
  constructor() {
    for (const kind of ["createQuest", "assignRelease", "addTag"] as const)
      this.registry.register(kind, { prepare: (input) => this.prepare(input) });
  }
  protected async prepare(
    input: Parameters<AutomationDomainHandler["prepare"]>[0],
  ): ReturnType<AutomationDomainHandler["prepare"]> {
    const { action, rule, user } = input;
    if (action.kind === "appendFolio")
      throw new BadRequestError("Folio writes belong to Knowledge");
    const result: AutomationMutationState["result"] = (repository, data) => {
      const where = {
        projectId: rule.projectId,
        ...(data.id
          ? { id: Number(data.id) }
          : { shortId: Number(data.shortId) }),
      };
      return {
        result: {
          changed: true,
          ...(typeof data.id === "number" ? { quest_id: data.id } : {}),
          ...(typeof data.shortId === "number"
            ? { shortId: data.shortId }
            : {}),
          ...(action.kind === "assignRelease"
            ? { release_id: Number(action.release) }
            : {}),
        },
        expressions: {
          ...(action.kind === "createQuest"
            ? { quest_id: repository.scalar(where, "id") }
            : {}),
          revision: repository.scalar(where, "version"),
        },
      };
    };
    if (action.kind === "createQuest") {
      const body = questCreateSchema.parse({
        projectId: rule.projectId,
        title: action.title,
        description: action.description,
        area: action.area,
        priority: "medium",
      });
      const cap = await this.service.assertCapacity(rule.projectId);
      return {
        target: { table: "quests", mode: "create" },
        result,
        condition: sql`(SELECT COUNT(*) FROM quests WHERE project_id = ${rule.projectId} AND deleted_at IS NULL) < ${cap}`,
        invoke: () => this.api().createQuest({ body }, { user }),
      };
    }
    const quest = await this.quests.getOne({
      where: { id: Number(action.quest), projectId: rule.projectId },
    });
    const project = await this.projects.getById(rule.projectId);
    await this.edit.assert(quest, project, user);
    // Preserve the live authoring-key ceiling on the ownership alternative.
    if (
      quest.createdBy !== user.id &&
      !(
        await this.access.authorize(rule.projectId, user, "automation:write")
      ).permissions.includes("quest:delete")
    )
      throw new ForbiddenError(
        "Editing another author's quest requires quest:delete within the authoring credential",
      );
    const target = { table: "quests", mode: "update" as const, id: quest.id };
    if (action.kind === "assignRelease") {
      const release = await this.releases.getOne({
        where: { id: Number(action.release), projectId: rule.projectId },
      });
      if (release.releasedAt) throw new BadRequestError("Release is published");
      if (quest.releaseId != null && quest.releaseId !== release.id)
        throw new ConflictError(
          "Quest has a conflicting explicit release assignment",
        );
      if (quest.releaseId === release.id)
        return {
          target,
          result,
          unchanged: { quest_id: quest.id, release_id: release.id },
          invoke: async () => {},
        };
      return {
        target,
        result,
        // The quest subquery adds the soft-delete filter the raw guard
        // lacked; a deleted quest is refused by the update it guards anyway.
        condition: sql`EXISTS ${this.releases.subquery({
          id: release.id,
          projectId: rule.projectId,
          releasedAt: { isNull: true },
        })} AND EXISTS ${this.quests.subquery({
          id: quest.id,
          projectId: rule.projectId,
          or: [
            { releaseId: { isNull: true } },
            { releaseId: { eq: release.id } },
          ],
        })}`,
        invoke: () =>
          this.api().updateQuestById(
            {
              params: { id: quest.id },
              body: { releaseId: release.id, expectedVersion: quest.version },
            },
            { user },
          ),
      };
    }
    const tags = normalizeQuestTags([...quest.tags, action.tag]);
    if (JSON.stringify(tags) === JSON.stringify(quest.tags))
      return {
        target,
        result,
        unchanged: { quest_id: quest.id },
        invoke: async () => {},
      };
    return {
      target,
      result,
      invoke: () =>
        this.api().updateQuestById(
          {
            params: { id: quest.id },
            body: { tags, expectedVersion: quest.version },
          },
          { user },
        ),
    };
  }
}
