import {
  BatchRepository,
  GuardedBatch,
  HourlyChecks,
  ProjectEvents,
  ProjectSecurityService,
} from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { formatReference } from "@lore/core/web";
import { $inject, Alepha } from "alepha";
import { users } from "alepha/api/users";
import { $logger } from "alepha/logger";
import {
  $repository,
  DbCacheProvider,
  SqlExpressionProvider,
  sql,
} from "alepha/orm";

import {
  type Quest,
  quests,
  REMINDER_INTERVAL_MS,
} from "../entities/quests.ts";
import { QuestReminderNotifications } from "../notifications/QuestReminderNotifications.ts";
import { WorkProjectEvents } from "./WorkProjectEvents.ts";

/**
 * Quest reminders, a plain feature of Plan (#Q3893), gated by its `reminder`
 * option. A check of the hourly job:
 *
 * - **One indexed query** for every quest whose `reminderNextAt` has passed,
 *   across all projects (`quests_reminders_due_idx`, led by
 *   `reminderNextAt`), at most {@link LIMIT} per tick, the rest at the next.
 *   A tick with nothing due costs that one query.
 * - Only then the projects' options: a project with Plan's `reminder`
 *   option off, or Plan off, sends nothing.
 * - **Once.** `reminderNextAt` advances by the quest's interval from the
 *   tick, never from the old due date, in the guarded batch that claims the
 *   reminder: its condition is the due date the tick read, so a second tick
 *   finds it moved and sends nothing, and a reminder thirty days stale fires
 *   once. The quest's history gets `reminder_sent` in the same write, and
 *   `quest.reminder_due` is recorded with it, so a channel can subscribe.
 * - The assignee is told directly, in the inbox and by email as their
 *   settings say, after the batch committed.
 * - A draft is not reminded (`draftAt IS NULL`, #E178). A reminder needs an
 *   assignee, and a draft cannot be accepted, so the conjunct is the
 *   defensive half of that rule rather than a filter anything reaches today;
 *   it used to read a draft epic's ids, and a quest of a draft epic that
 *   nobody took carries `draftAt` now.
 */
export class QuestReminders {
  public static readonly LIMIT = 100;

  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly checks = $inject(HourlyChecks);
  protected readonly batch = $inject(GuardedBatch);
  protected readonly events = $inject(ProjectEvents);
  protected readonly definitions = $inject(WorkProjectEvents);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly sqlx = $inject(SqlExpressionProvider);
  protected readonly cache = $inject(DbCacheProvider);
  protected readonly notifications = $inject(QuestReminderNotifications);
  protected readonly quests = $inject(BatchRepository.of(quests));
  protected readonly projects = $repository(projects);
  protected readonly users = $repository(users);

  constructor() {
    this.checks.register({
      name: "quests.reminders",
      run: async (now) => {
        await this.run(now);
      },
    });
  }

  /**
   * The quests due at `now`, oldest due first: one query.
   */
  public async due(now: string): Promise<Quest[]> {
    return this.quests.findMany({
      where: {
        reminderNextAt: { lte: now },
        reminderInterval: { isNotNull: true },
        acceptedAt: { isNotNull: true },
        acceptedBy: { isNotNull: true },
        completedAt: { isNull: true },
        shelvedAt: { isNull: true },
        draftAt: { isNull: true },
      },
      orderBy: [{ column: "reminderNextAt", direction: "asc" }],
      limit: QuestReminders.LIMIT,
    });
  }

  /**
   * Reminds every quest due at `now`. Answers how many were reminded.
   */
  public async run(now: string): Promise<number> {
    const due = await this.due(now);
    if (!due.length) return 0;
    const on = new Map<number, boolean>();
    for (const projectId of new Set(due.map((quest) => quest.projectId))) {
      const plan = (await this.security.capabilitiesOf(projectId)).plan;
      on.set(projectId, plan?.reminder === true);
    }
    let sent = 0;
    for (const quest of due) {
      if (!on.get(quest.projectId)) continue;
      if (await this.remind(quest, now)) sent++;
    }
    return sent;
  }

  protected async remind(quest: Quest, now: string): Promise<boolean> {
    const interval = quest.reminderInterval!;
    const assignee = quest.acceptedBy!;
    const next = new Date(
      new Date(now).getTime() + REMINDER_INTERVAL_MS[interval],
    ).toISOString();
    const project = await this.projects.getById(quest.projectId);
    const path = `/${project.slug || `project-${project.id}`}/quests/${quest.shortId}`;
    const recorded = await this.events.emit({
      projectId: quest.projectId,
      name: "quest.reminder_due",
      subjectId: quest.shortId,
      fields: {
        project: project.title,
        title: quest.title,
        quest_id: quest.id,
        shortId: quest.shortId,
        area: quest.area,
        assignee_id: assignee,
        url: path,
      },
    });
    const condition = sql`EXISTS ${this.quests.subquery({
      id: quest.id,
      reminderNextAt: { eq: quest.reminderNextAt! },
      acceptedBy: assignee,
      completedAt: { isNull: true },
    })}`;
    try {
      await this.batch.guarded(condition, [
        this.quests.updateStatement(
          { id: quest.id },
          {
            reminderNextAt: next,
            history: this.sqlx.jsonArrayAppend(sql`history`, {
              at: now,
              by: assignee,
              action: "reminder_sent",
            }) as never,
          },
          { now, force: true, returning: false },
        ),
        ...recorded.statements,
      ]);
    } catch {
      // Another tick claimed it first, or the quest moved since the read.
      return false;
    }
    await this.cache.invalidateTable("quests");
    await recorded.committed();
    const account = await this.users.findById(assignee);
    if (!account?.enabled) return true;
    const variables = {
      projectTitle: project.title,
      reference: formatReference("quest", quest.shortId),
      title: quest.title,
      href: path,
      url: `${String(this.alepha.env.PUBLIC_URL ?? "")}${path}`,
      scope: `project:${project.id}`,
    };
    const lang = this.notifications.lang;
    await this.notifications.inbox.push({
      contact: `lore-user:${account.id}`,
      lang,
      variables,
    });
    if (account.email)
      await this.notifications.email.push({
        contact: account.email,
        lang,
        variables,
      });
    return true;
  }
}
