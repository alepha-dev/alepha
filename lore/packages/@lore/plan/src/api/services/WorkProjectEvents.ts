import { ProjectEventCatalog } from "@lore/core/api";
import { $inject } from "alepha";

/**
 * Plan's project events (#Q3889): feedback, releases, epics and quests.
 * State changes only: a plain edit of a quest emits nothing.
 */
export class WorkProjectEvents {
  protected readonly catalog = $inject(ProjectEventCatalog);

  constructor() {
    this.catalog.register({
      name: "feedback.created",
      label: "Feedback submitted",
      resource: "feedback",
      subject: "feedback",
      fields: {
        feedback_id: "number",
        shortId: "number",
        reference: "text",
        description: "text",
      },
      needs: { capability: "plan", option: "feedback" },
      permission: "feedback:read",
    });
    this.catalog.register({
      name: "release.published",
      label: "Release published",
      resource: "releases",
      subject: "release",
      fields: {
        release_id: "number",
        release_tag: "text",
        publisher_id: "member",
        changelog: "text",
        quest_count: "number",
      },
      needs: { capability: "plan", option: "releases" },
      permission: "release:read",
    });
    this.catalog.register({
      name: "epic.completed",
      label: "Epic completed",
      resource: "epics",
      subject: "epic",
      fields: { epic_id: "number", shortId: "number", quest_count: "number" },
      needs: { capability: "plan", option: "epics" },
      permission: "epic:read",
    });
    const quest = {
      quest_id: "number",
      shortId: "number",
      area: "text",
      actor_id: "member",
    } as const;
    this.catalog.register({
      name: "quest.created",
      label: "Quest created",
      resource: "quests",
      subject: "quest",
      fields: { ...quest },
      needs: { capability: "plan" },
      permission: "quest:read",
    });
    this.catalog.register({
      name: "quest.assigned",
      label: "Quest accepted or assigned",
      resource: "quests",
      subject: "quest",
      fields: { ...quest, assignee_id: "member" },
      needs: { capability: "plan" },
      permission: "quest:read",
    });
    this.catalog.register({
      name: "quest.held",
      label: "Quest put on hold",
      resource: "quests",
      subject: "quest",
      fields: { ...quest },
      needs: { capability: "plan" },
      permission: "quest:read",
    });
    this.catalog.register({
      name: "quest.completed",
      label: "Quest completed",
      resource: "quests",
      subject: "quest",
      fields: { ...quest },
      needs: { capability: "plan" },
      permission: "quest:read",
    });
  }
}
