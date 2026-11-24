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
      message: (it) => ({
        title: `New feedback ${this.text(it.reference)}: ${this.text(it.title)}`,
        text: this.text(it.description) || "The report has no description.",
      }),
    });
    // A member trusted an item written outside the team (#Q4216, #Q4227):
    // an agent may read it from now on, so a triage automation hears it.
    this.catalog.register({
      name: "feedback.trusted",
      label: "Feedback trusted",
      resource: "feedback",
      subject: "feedback",
      fields: {
        feedback_id: "number",
        shortId: "number",
        reference: "text",
        trusted_by: "member",
      },
      needs: { capability: "plan", option: "feedback" },
      permission: "feedback:read",
      message: (it) => ({
        title: `Feedback ${this.text(it.reference)} trusted: ${this.text(it.title)}`,
        text: "A member trusted this report written outside the team: an agent may read it now.",
      }),
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
      message: (it) => ({
        title: `Release ${this.text(it.release_tag) || this.text(it.title)} published`,
        text: `${this.count(it.quest_count, "quest")} shipped in this release.`,
      }),
    });
    this.catalog.register({
      name: "epic.completed",
      label: "Epic completed",
      resource: "epics",
      subject: "epic",
      fields: { epic_id: "number", shortId: "number", quest_count: "number" },
      needs: { capability: "plan", option: "epics" },
      permission: "epic:read",
      message: (it) => ({
        title: `Epic #E${this.text(it.shortId)} completed: ${this.text(it.title)}`,
        text: `All ${this.count(it.quest_count, "quest")} of the epic are done or set aside.`,
      }),
    });
    // An epic filed and an epic marked ready (#Q4276): what a prompt's
    // trigger listens to, `review-epic` on a new one, `work-epic` on a ready
    // one. Its `epic` arg is filled from the event's subject.
    this.catalog.register({
      name: "epic.created",
      label: "Epic created",
      resource: "epics",
      subject: "epic",
      fields: { epic_id: "number", shortId: "number", actor_id: "member" },
      needs: { capability: "plan", option: "epics" },
      permission: "epic:read",
      message: (it) => ({
        title: `New epic #E${this.text(it.shortId)}: ${this.text(it.title)}`,
        text: "It is a draft: its plan is open.",
      }),
    });
    this.catalog.register({
      name: "epic.ready",
      label: "Epic marked ready",
      resource: "epics",
      subject: "epic",
      fields: { epic_id: "number", shortId: "number", actor_id: "member" },
      needs: { capability: "plan", option: "epics" },
      permission: "epic:read",
      message: (it) => ({
        title: `Epic #E${this.text(it.shortId)} is ready: ${this.text(it.title)}`,
        text: "Its plan is done: its quests can be worked.",
      }),
    });
    // A pull request recorded on a quest or an epic (#Q4276), once per pull
    // request and project: `review-pr` listens to it.
    this.catalog.register({
      name: "pull_request.added",
      label: "Pull request added",
      resource: "quests",
      subject: "pull_request",
      fields: {
        number: "number",
        repository: "text",
        pull_request_url: "text",
        quest_shortId: "number",
        epic_number: "number",
        actor_id: "member",
      },
      needs: { capability: "plan" },
      permission: "quest:read",
      message: (it) => ({
        title: `Pull request #${this.text(it.number)} added: ${this.text(it.title)}`,
        text: `Recorded on ${
          it.quest_shortId
            ? `quest #Q${this.text(it.quest_shortId)}`
            : `epic #E${this.text(it.epic_number)}`
        }.`,
      }),
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
      message: (it) => ({
        title: `New quest #Q${this.text(it.shortId)}: ${this.text(it.title)}`,
        text: it.area
          ? `Filed in ${this.text(it.area)}.`
          : "Filed with no area.",
      }),
    });
    this.catalog.register({
      name: "quest.assigned",
      label: "Quest accepted or assigned",
      resource: "quests",
      subject: "quest",
      fields: { ...quest, assignee_id: "member" },
      needs: { capability: "plan" },
      permission: "quest:read",
      message: (it) => ({
        title: `Quest #Q${this.text(it.shortId)} is in progress: ${this.text(it.title)}`,
        text: "Someone accepted it or was assigned to it.",
      }),
    });
    this.catalog.register({
      name: "quest.held",
      label: "Quest put on hold",
      resource: "quests",
      subject: "quest",
      fields: { ...quest },
      needs: { capability: "plan" },
      permission: "quest:read",
      message: (it) => ({
        title: `Quest #Q${this.text(it.shortId)} is on hold: ${this.text(it.title)}`,
        text: "It waits on something; its discussion says what.",
      }),
    });
    this.catalog.register({
      name: "quest.reminder_due",
      label: "Quest reminder due",
      resource: "quests",
      subject: "quest",
      fields: { ...quest, assignee_id: "member" },
      needs: { capability: "plan", option: "reminder" },
      permission: "quest:read",
      message: (it) => ({
        title: `Reminder: quest #Q${this.text(it.shortId)} ${this.text(it.title)}`,
        text: "It is still held and still open.",
      }),
    });
    this.catalog.register({
      name: "quest.completed",
      label: "Quest completed",
      resource: "quests",
      subject: "quest",
      fields: { ...quest },
      needs: { capability: "plan" },
      permission: "quest:read",
      message: (it) => ({
        title: `Quest #Q${this.text(it.shortId)} completed: ${this.text(it.title)}`,
        text: "It is done.",
      }),
    });
  }

  protected text(value: string | number | boolean | null | undefined): string {
    return value === null || value === undefined ? "" : String(value);
  }

  protected count(value: unknown, noun: string): string {
    const n = typeof value === "number" ? value : 0;
    return `${n} ${noun}${n === 1 ? "" : "s"}`;
  }
}
