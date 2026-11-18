import { $inject, Alepha, AlephaError } from "alepha";
import { JobProvider, jobExecutionEntity } from "alepha/api/jobs";
import { users } from "alepha/api/users";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, type SQLLike } from "alepha/orm";

import { eventSubscriptions } from "../entities/eventSubscriptions.ts";
import type { ProjectEvent } from "../entities/projectEvents.ts";
import { projects } from "../entities/projects.ts";
import { ProjectEventNotifications } from "../notifications/ProjectEventNotifications.ts";
import type { SubscriptionChannel } from "../schemas/subscriptionChannelSchema.ts";
import { BatchRepository } from "./BatchRepository.ts";
import { ProjectEventCatalog } from "./ProjectEventCatalog.ts";
import { ProjectRecipients } from "./ProjectRecipients.ts";

/**
 * Delivers a project event to its subscribers (#Q3890).
 *
 * - **One job per event, written with the event.** `prepare` returns the
 *   `job_executions` insert the emit adds to the change's guarded batch, so
 *   an event is never stored that nobody is told about; `dispatch` sends it
 *   to the queue after the commit, and a lost dispatch is recovered by the
 *   framework's `*\/5` job sweep, which re-dispatches a pending row. On D1 a
 *   `$job.push` would be a second, separate write, which is why the row is
 *   built here.
 * - **No subscriber, no job.** `prepare` reads whether the project has an
 *   unmuted subscription to the event first.
 * - **Once per recipient, except at a crash.** `deliver` runs one memoised
 *   step per subscription and channel: a replayed job sends nothing again;
 *   a handler that dies between a send and its record sends that one again.
 * - **Permissions are checked at delivery** (`ProjectRecipients`): a member
 *   who left, was disabled or lost the event's read permission receives
 *   nothing, and it is not an error.
 */
export class ProjectEventDelivery {
  public static readonly JOB = "project-events.deliver";

  protected readonly alepha = $inject(Alepha);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly jobs = $inject(JobProvider);
  protected readonly catalog = $inject(ProjectEventCatalog);
  protected readonly recipients = $inject(ProjectRecipients);
  protected readonly notifications = $inject(ProjectEventNotifications);
  protected readonly subscriptions = $repository(eventSubscriptions);
  protected readonly projects = $repository(projects);
  protected readonly users = $repository(users);
  protected readonly executions = $inject(
    BatchRepository.of(jobExecutionEntity),
  );
  protected readonly log = $logger();

  /**
   * The delivery job's row for one event, or nothing when no unmuted
   * subscription to it exists in the project.
   */
  public async prepare(
    projectId: number,
    name: string,
    eventId: string,
  ): Promise<{ id: string; statements: SQLLike[] } | undefined> {
    const subscribed = await this.subscriptions.findOne({
      where: { projectId, event: name, mutedAt: { isNull: true } },
    });
    if (!subscribed) return undefined;
    const registration = this.jobs
      .getRegisteredJobs()
      .get(ProjectEventDelivery.JOB);
    if (!registration)
      throw new AlephaError("The project event delivery job is unavailable");
    const id = this.crypto.randomUUID();
    const now = this.dateTime.nowISOString();
    return {
      id,
      statements: [
        this.executions.insertStatement({
          id,
          createdAt: now,
          updatedAt: now,
          jobName: ProjectEventDelivery.JOB,
          key: `project-event:${eventId}`,
          status: "pending",
          attempt: 0,
          maxAttempts: (registration.options.retry?.retries ?? 0) + 1,
          redispatchCount: 0,
          payload: { eventId },
        }),
      ],
    };
  }

  /**
   * Sends a committed job row to the queue. A failure leaves the pending
   * row for the job sweep: it is never turned into a second row.
   */
  public async dispatch(id: string): Promise<void> {
    try {
      await this.jobs.dispatcher.dispatch(ProjectEventDelivery.JOB, id);
    } catch {
      this.log.warn("Project event delivery deferred to the job sweep", {
        executionId: id,
      });
    }
  }

  /**
   * The delivery job's body: every unmuted subscription to the event whose
   * filter matches, each channel in its own memoised step.
   */
  public async deliver(
    event: ProjectEvent,
    step: (name: string, fn: () => Promise<boolean>) => Promise<boolean>,
  ): Promise<number> {
    const definition = this.catalog.find(event.name);
    if (!definition) return 0;
    const rows = await this.subscriptions.findMany({
      where: {
        projectId: event.projectId,
        event: event.name,
        mutedAt: { isNull: true },
      },
      orderBy: "createdAt",
      limit: 500,
    });
    const project = await this.projects.findById(event.projectId);
    if (!project) return 0;
    let sent = 0;
    for (const row of rows) {
      if (!this.matches(row.filter, definition.filter?.field, event)) continue;
      // A channel: posted as the project, with no member to check (#Q3891).
      if (row.channelId) {
        const channelId = row.channelId;
        if (
          await step(`deliver.${row.id}.channel`, () =>
            this.post(channelId, project, event),
          )
        )
          sent++;
        continue;
      }
      if (!row.memberId) continue;
      const refusal = await this.recipients.refusal(
        event.projectId,
        row.memberId,
        definition.permission,
      );
      if (refusal) continue;
      const account = await this.users.findById(row.memberId);
      if (!account) continue;
      for (const channel of row.channels) {
        // The inbox files by account, whatever the address's spelling.
        const contact =
          channel === "inapp" ? `lore-user:${account.id}` : account.email;
        if (!contact) continue;
        if (
          await step(`deliver.${row.id}.${channel}`, () =>
            this.send(channel, contact, project, event),
          )
        )
          sent++;
      }
    }
    return sent;
  }

  /**
   * Whether a subscription's filter admits an event: no filter admits
   * every one, a filter compares the catalog's filter field.
   */
  public matches(
    filter: string | undefined,
    field: string | undefined,
    event: Pick<ProjectEvent, "fields">,
  ): boolean {
    if (!filter) return true;
    if (!field) return false;
    const value = event.fields[field];
    return value !== null && value !== undefined && String(value) === filter;
  }

  /**
   * The event's message, as the member reads it.
   */
  public render(
    event: Pick<ProjectEvent, "name" | "fields">,
    lang: string,
  ): { title: string; text: string } {
    return this.catalog.get(event.name).message(event.fields, lang);
  }

  /**
   * Posts the event to a project's notification channel, through the
   * template of its kind.
   */
  protected async post(
    channelId: string,
    project: { id: number; title: string },
    event: ProjectEvent,
  ): Promise<boolean> {
    await this.notifications.discord.push({
      lang: this.notifications.lang,
      variables: { ...this.variables(project, event), channelId },
    });
    return true;
  }

  protected variables(
    project: { id: number; title: string },
    event: ProjectEvent,
  ) {
    const message = this.render(event, this.notifications.lang);
    const href = typeof event.fields.url === "string" ? event.fields.url : "";
    return {
      projectTitle: project.title,
      title: message.title,
      text: message.text,
      href,
      url: `${String(this.alepha.env.PUBLIC_URL ?? "")}${href}`,
      scope: `project:${project.id}`,
    };
  }

  protected async send(
    channel: SubscriptionChannel,
    contact: string,
    project: { id: number; title: string },
    event: ProjectEvent,
  ): Promise<boolean> {
    const lang = this.notifications.lang;
    const variables = this.variables(project, event);
    const template =
      channel === "email" ? this.notifications.email : this.notifications.inbox;
    await template.push({ contact, lang, variables });
    return true;
  }
}
