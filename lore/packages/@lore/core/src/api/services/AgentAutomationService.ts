import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, DbConflictError } from "alepha/orm";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "alepha/server";

import {
  type AgentAutomation,
  agentAutomations,
} from "../entities/agentAutomations.ts";
import { projects } from "../entities/projects.ts";
import { projectThresholds } from "../entities/projectThresholds.ts";
import type { AgentAutomationWrite } from "../schemas/agentAutomationWriteSchema.ts";
import {
  AgentAutomationKinds,
  type AgentAutomationRunOutcome,
} from "./AgentAutomationKinds.ts";
import { AgentJobs } from "./AgentJobs.ts";
import { AgentRunPreamble } from "./AgentRunPreamble.ts";
import { AutomationProjectEvents } from "./AutomationProjectEvents.ts";
import { HostJobs } from "./HostJobs.ts";
import { ProjectDeletionService } from "./ProjectDeletionService.ts";
import { ProjectEventCatalog } from "./ProjectEventCatalog.ts";
import { ProjectSecurityService } from "./ProjectSecurityService.ts";
import { SourceRepository } from "./SourceRepository.ts";

/**
 * Agent automations (#E172, #Q4226): a prompt run on an Agent host, by hand,
 * on a project event or on a schedule. Who may call what is the
 * controller's (`automation:manage` to write and run, `host:read` to read);
 * this service holds the rules of the row and of a run.
 *
 * **What it is not** (folio #F1526, which deleted Lore's earlier
 * Automations): no step, no branch, no condition language, no canvas. One
 * row, one prompt, one trigger. A need for more is a new epic, not a column.
 *
 * A run:
 * - is one host job through core's agent job service (a build, one per
 *   quest), carrying the automation's id;
 * - runs alone: a run while one of its jobs is queued or running starts
 *   nothing, and says so;
 * - is started by a member whose rank bounds its job key: whoever runs it
 *   by hand, else its owner (`createdBy`), who must hold the permission a
 *   run by hand of the same prompt asks;
 * - ignores `enabled` and `onlyIfWork` when it is by hand.
 */
export class AgentAutomationService {
  /**
   * The permission a `text` automation's run needs, as `lore agent run
   * text` does: it asks the host for anything its starter's rank allows.
   */
  public static readonly TEXT_PERMISSION = "host:update";

  protected readonly log = $logger();
  protected readonly rows = $repository(agentAutomations);
  protected readonly kinds = $inject(AgentAutomationKinds);
  protected readonly agents = $inject(AgentJobs);
  protected readonly hostJobs = $inject(HostJobs);
  protected readonly preamble = $inject(AgentRunPreamble);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly deletion = $inject(ProjectDeletionService);
  protected readonly catalog = $inject(ProjectEventCatalog);
  protected readonly projects = $repository(projects);
  protected readonly thresholds = $repository(projectThresholds);
  protected readonly events = $inject(SourceRepository.of(agentAutomations));
  /** Injected so its events are in the catalog whatever booted core. */
  protected readonly eventDefinitions = $inject(AutomationProjectEvents);

  constructor() {
    // A deleted project is a soft delete: no cascade removes its
    // automations, and a schedule must not keep running for it.
    this.deletion.registerStep({
      order: 22,
      before: true,
      run: async (projectId) => {
        await this.rows.deleteMany({ projectId: { eq: projectId } });
      },
    });
  }

  public async list(projectId: number): Promise<AgentAutomation[]> {
    return this.rows.findMany({
      where: { projectId: { eq: projectId } },
      orderBy: [{ column: "name", direction: "asc" }],
    });
  }

  /**
   * One automation of the project, by its id or its name.
   */
  public async find(projectId: number, ref: string): Promise<AgentAutomation> {
    const byId =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const row = await this.rows.findOne({
      where: byId.test(ref)
        ? { projectId: { eq: projectId }, id: { eq: ref } }
        : { projectId: { eq: projectId }, name: { eq: ref } },
    });
    if (!row) {
      throw new NotFoundError(`No automation "${ref}" in this project`);
    }
    return row;
  }

  public async create(
    projectId: number,
    userId: string,
    body: AgentAutomationWrite & { name: string },
  ): Promise<AgentAutomation> {
    const draft = this.merged(undefined, body);
    await this.validate(projectId, draft);
    await this.assertNameFree(projectId, body.name);
    try {
      return await this.rows.create({
        ...draft,
        nextRunAt: draft.nextRunAt ?? undefined,
        projectId,
        name: body.name,
        createdBy: userId,
      });
    } catch (error) {
      if (error instanceof DbConflictError) {
        throw new ConflictError(
          `An automation named "${body.name}" already exists`,
        );
      }
      throw error;
    }
  }

  /**
   * Changes what the body names. An automation whose owner is gone is
   * taken over by whoever edits it.
   */
  public async update(
    projectId: number,
    ref: string,
    userId: string,
    body: AgentAutomationWrite,
  ): Promise<AgentAutomation> {
    const row = await this.find(projectId, ref);
    const draft = this.merged(row, body);
    await this.validate(projectId, draft);
    if (body.name && body.name !== row.name) {
      await this.assertNameFree(projectId, body.name);
    }
    try {
      await this.rows.updateById(row.id, {
        ...draft,
        nextRunAt: draft.nextRunAt as never,
        ...(body.name ? { name: body.name } : {}),
        ...(row.createdBy ? {} : { createdBy: userId }),
      });
    } catch (error) {
      if (error instanceof DbConflictError) {
        throw new ConflictError(
          `An automation named "${body.name}" already exists`,
        );
      }
      throw error;
    }
    return this.find(projectId, row.id);
  }

  public async remove(projectId: number, ref: string): Promise<void> {
    const row = await this.find(projectId, ref);
    await this.rows.deleteById(row.id);
  }

  /**
   * Runs an automation once. `startedBy` is the member running it by hand;
   * absent, its owner. Answers the jobs it started, or why none started.
   */
  public async run(
    automation: AgentAutomation,
    input: {
      startedBy?: string;
      startedByJobId?: string;
      /** The most jobs this run may start: what its ceilings leave. */
      limit?: number;
    } = {},
  ): Promise<AgentAutomationRunOutcome> {
    const startedBy = input.startedBy ?? automation.createdBy;
    if (!startedBy) {
      return {
        jobIds: [],
        skipped:
          "This automation's owner is no longer a member: a member takes it over by editing it",
      };
    }
    const active = await this.hostJobs.activeForAutomation(automation.id);
    const slots = Math.min(
      this.concurrencyOf(automation) - active.length,
      input.limit ?? Number.POSITIVE_INFINITY,
    );
    if (slots <= 0) {
      return {
        jobIds: [],
        skipped: "A run of this automation is already queued or running",
      };
    }
    const kind =
      automation.promptKind === "text"
        ? undefined
        : this.kinds.find(automation.promptKind);
    if (automation.promptKind !== "text" && !kind) {
      throw new BadRequestError(
        `This Lore runs no ${automation.promptKind} automation`,
      );
    }
    const permission =
      kind?.permission ?? AgentAutomationService.TEXT_PERMISSION;
    if (
      !(await this.security.holds(automation.projectId, startedBy, permission))
    ) {
      throw new ForbiddenError(
        `A ${automation.promptKind} automation's run needs the ${permission} permission`,
      );
    }
    const outcome = kind
      ? await kind.run(automation, {
          startedBy,
          startedByJobId: input.startedByJobId,
          slots,
        })
      : await this.runText(automation, startedBy, input.startedByJobId);
    const last = outcome.jobIds[outcome.jobIds.length - 1];
    await this.rows.updateById(automation.id, {
      lastRunAt: this.dateTime.nowISOString(),
      ...(last ? { lastJobId: last } : {}),
    });
    return outcome;
  }

  /**
   * A run its trigger started (#Q4227): as its owner, never thrown. A
   * refusal (the chain guard, a host gone, a permission the owner lost) is
   * logged and answered as a skip, so the event or tick that caused it is
   * not retried into the same refusal.
   */
  public async runTriggered(
    automation: AgentAutomation,
    startedByJobId?: string,
  ): Promise<AgentAutomationRunOutcome> {
    let outcome: AgentAutomationRunOutcome;
    try {
      // The guards first (#Q4230): the project's pause, the host, the
      // ceilings. None of them queues anything or counts as a failure.
      const gate = await this.gate(automation);
      // "Only if there is something" (#Q4228): a plain query before any
      // job is queued, for an event run as for a scheduled one.
      outcome =
        "skipped" in gate
          ? { jobIds: [], skipped: gate.skipped }
          : automation.onlyIfWork && !(await this.hasWork(automation))
            ? { jobIds: [], skipped: "Nothing to do" }
            : await this.run(automation, {
                startedByJobId,
                limit: gate.limit,
              });
      if ("skipped" in gate && gate.ceiling) {
        await this.ceilingReached(automation, gate.skipped);
      }
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "The run was refused";
      this.log.warn("An agent automation's run was refused", {
        automation: automation.id,
        reason,
      });
      outcome = { jobIds: [], skipped: reason };
    }
    if (!outcome.jobIds.length && outcome.skipped) {
      await this.rows.updateById(automation.id, {
        lastSkippedAt: this.dateTime.nowISOString(),
        lastSkippedReason: outcome.skipped.slice(0, 500),
      });
    }
    return outcome;
  }

  /**
   * The default of the project's daily ceiling on automation builds.
   */
  public static readonly BUILDS_PER_DAY = 20;

  /**
   * What stops a triggered run before anything is asked of a host
   * (#Q4230), or the most jobs it may start:
   * - the project's pause (`automationsPausedAt`);
   * - its host offline, or no longer reporting its agent: a skip, never a
   *   failure;
   * - its own ceilings, runs per hour and per day, counted on its jobs;
   * - for a build, the project's builds per day.
   */
  public async gate(
    automation: AgentAutomation,
  ): Promise<{ limit: number } | { skipped: string; ceiling?: boolean }> {
    const project = await this.projects.findOne({
      where: { id: { eq: automation.projectId } },
    });
    if (project?.automationsPausedAt) {
      return { skipped: "Automations are paused in this project" };
    }
    const host = await this.hostOf(automation);
    if (host) return { skipped: host };
    const now = this.dateTime.nowMillis();
    const ago = (ms: number) => new Date(now - ms).toISOString();
    const hour = await this.hostJobs.countAutomationJobs({
      automationId: automation.id,
      since: ago(3_600_000),
    });
    if (hour >= automation.maxRunsPerHour) {
      return {
        skipped: `Ceiling reached: ${automation.maxRunsPerHour} runs in the last hour`,
        ceiling: true,
      };
    }
    const day = await this.hostJobs.countAutomationJobs({
      automationId: automation.id,
      since: ago(86_400_000),
    });
    if (day >= automation.maxRunsPerDay) {
      return {
        skipped: `Ceiling reached: ${automation.maxRunsPerDay} runs in the last day`,
        ceiling: true,
      };
    }
    let limit = Math.min(
      automation.maxRunsPerHour - hour,
      automation.maxRunsPerDay - day,
    );
    if (automation.promptKind === "build") {
      const cap = await this.buildsPerDay(automation.projectId);
      const built = await this.hostJobs.countAutomationJobs({
        projectId: automation.projectId,
        subjectType: "quest",
        since: ago(86_400_000),
      });
      if (built >= cap) {
        return {
          skipped: `Ceiling reached: the project's ${cap} automation builds in the last day`,
          ceiling: true,
        };
      }
      limit = Math.min(limit, cap - built);
    }
    return { limit };
  }

  /**
   * Why the automation's host cannot take a run now, or undefined: offline,
   * gone, or no longer reporting the agent it names (#Q4220).
   */
  protected async hostOf(
    automation: AgentAutomation,
  ): Promise<string | undefined> {
    let resolved: Awaited<ReturnType<AgentJobs["resolve"]>>;
    try {
      resolved = await this.agents.resolve(
        automation.projectId,
        this.whereOf(automation),
      );
    } catch (error) {
      return error instanceof Error ? error.message : "No Agent host";
    }
    if (resolved.host.offline) {
      return `Host "${resolved.host.slug}" is offline`;
    }
    if (resolved.host.status && resolved.host.status !== "available") {
      return `Host "${resolved.host.slug}" is ${resolved.host.status}`;
    }
    return undefined;
  }

  /**
   * The project's daily ceiling on automation builds.
   */
  public async buildsPerDay(projectId: number): Promise<number> {
    const row = await this.thresholds.findOne({
      where: { projectId: { eq: projectId } },
    });
    return row?.automationBuildsPerDay ?? AgentAutomationService.BUILDS_PER_DAY;
  }

  /**
   * Sets the project's daily ceiling on automation builds, `null` for the
   * default.
   */
  public async setBuildsPerDay(
    projectId: number,
    value: number | null,
  ): Promise<number> {
    const row = await this.thresholds.findOne({
      where: { projectId: { eq: projectId } },
    });
    if (row) {
      await this.thresholds.updateById(row.id, {
        automationBuildsPerDay: value as never,
      });
    } else if (value !== null) {
      await this.thresholds.create({
        projectId,
        automationBuildsPerDay: value,
      });
    }
    return this.buildsPerDay(projectId);
  }

  /**
   * Pauses every automation of the project, or resumes them (#Q4230).
   */
  public async setPaused(projectId: number, paused: boolean): Promise<void> {
    await this.projects.updateById(projectId, {
      automationsPausedAt: (paused
        ? this.dateTime.nowISOString()
        : null) as never,
    });
  }

  public async pausedAt(projectId: number): Promise<string | undefined> {
    const project = await this.projects.findOne({
      where: { id: { eq: projectId } },
    });
    return project?.automationsPausedAt ?? undefined;
  }

  /**
   * Records a ceiling's refusal with `automation.ceiling.reached`, once per
   * stretch: a second refusal for the same reason tells nobody again.
   */
  protected async ceilingReached(
    automation: AgentAutomation,
    reason: string,
  ): Promise<void> {
    if (automation.lastSkippedReason === reason) return;
    await this.events
      .sourceUpdate(
        { id: automation.id },
        {
          lastSkippedAt: this.dateTime.nowISOString(),
          lastSkippedReason: reason,
        },
        {
          projectId: automation.projectId,
          name: "automation.ceiling.reached",
          subjectId: automation.id,
          fields: {
            project: (
              await this.projects.findOne({
                where: { id: { eq: automation.projectId } },
              })
            )?.title,
            title: automation.name,
            automation_id: automation.id,
            automation: automation.name,
            reason,
          },
        },
      )
      .catch((error) =>
        this.log.warn("An automation's ceiling could not be recorded", {
          automation: automation.id,
          error,
        }),
      );
  }

  /**
   * Whether the automation's prompt has something to do now (#Q4228), as
   * the modules that own it answer. A text prompt has no such check.
   */
  public async hasWork(automation: AgentAutomation): Promise<boolean> {
    if (automation.promptKind === "text") return true;
    return this.kinds.hasWork(automation.promptKind, automation);
  }

  /**
   * The next time a schedule runs after `now` (#Q4228), on the hour in UTC:
   * the next hour, the next of 00, 06, 12 and 18, or the next `dailyHour`.
   */
  public nextRunAfter(
    automation: Pick<AgentAutomation, "schedule" | "dailyHour">,
    now: number,
  ): string | undefined {
    if (!automation.schedule) return undefined;
    const hour = 3_600_000;
    let next = Math.floor(now / hour) * hour + hour;
    const fits = (at: number) => {
      const h = new Date(at).getUTCHours();
      if (automation.schedule === "6h") return h % 6 === 0;
      if (automation.schedule === "daily")
        return h === (automation.dailyHour ?? 0);
      return true;
    };
    while (!fits(next)) next += hour;
    return new Date(next).toISOString();
  }

  /**
   * How many of its jobs an automation runs at once: a build its
   * `concurrency` (#Q4229), every other kind one.
   */
  public concurrencyOf(automation: AgentAutomation): number {
    return automation.promptKind === "build"
      ? Math.max(1, automation.concurrency ?? 1)
      : 1;
  }

  /**
   * A `text` automation's run: its words under Lore's preamble, in a
   * workspace of its own.
   */
  protected async runText(
    automation: AgentAutomation,
    startedBy: string,
    startedByJobId?: string,
  ): Promise<AgentAutomationRunOutcome> {
    const workspace = `auto-${automation.name}`;
    const job = await this.agents.start({
      projectId: automation.projectId,
      ...this.whereOf(automation),
      prompt: `${await this.preamble.render(automation.projectId, true)}\n\n${automation.promptText ?? ""}`,
      workspace,
      startedBy,
      startedByJobId,
      automationId: automation.id,
      subjectType: "prompt",
      subjectId: workspace,
    });
    return { jobIds: [job.id] };
  }

  /**
   * The host, agent and model a run names, as a run by hand takes them.
   */
  public whereOf(automation: AgentAutomation): {
    host?: string;
    agent?: string;
    model?: string;
  } {
    return {
      ...(automation.host ? { host: automation.host } : {}),
      ...(automation.agent ? { agent: automation.agent } : {}),
      ...(automation.model ? { model: automation.model } : {}),
    };
  }

  /**
   * The row a write leaves: the stored one with the body's fields over it.
   * An empty string clears an optional field.
   */
  protected merged(
    row: AgentAutomation | undefined,
    body: AgentAutomationWrite,
  ): Omit<AgentAutomationWrite, "name" | "on"> & {
    promptKind: AgentAutomation["promptKind"];
    nextRunAt: string | null;
  } {
    const pick = <K extends "promptText" | "host" | "agent" | "model">(
      key: K,
    ) => {
      const value = body[key];
      if (value === undefined) return row?.[key] ?? undefined;
      return value === "" ? undefined : value;
    };
    const promptKind = body.promptKind ?? row?.promptKind;
    if (!promptKind) {
      throw new BadRequestError("An automation names its prompt");
    }
    const on = body.on === undefined ? undefined : this.parseOn(body.on);
    const trigger = on?.trigger ?? body.trigger ?? row?.trigger ?? "manual";
    const schedule = on
      ? on.schedule
      : (body.schedule ?? row?.schedule ?? undefined);
    const dailyHour = on
      ? on.dailyHour
      : (body.dailyHour ?? row?.dailyHour ?? undefined);
    // A schedule keeps its next run unless what decides it changed.
    const kept =
      row?.trigger === "schedule" &&
      row.schedule === schedule &&
      row.dailyHour === dailyHour &&
      row.nextRunAt;
    const nextRunAt =
      trigger !== "schedule"
        ? null
        : kept
          ? (row?.nextRunAt ?? null)
          : (this.nextRunAfter(
              { schedule, dailyHour },
              this.dateTime.nowMillis(),
            ) ?? null);
    return {
      promptKind,
      promptText: pick("promptText"),
      host: pick("host"),
      agent: pick("agent"),
      model: pick("model"),
      trigger,
      schedule,
      dailyHour,
      nextRunAt,
      eventKeys: on
        ? on.eventKeys
        : (body.eventKeys ?? row?.eventKeys ?? undefined),
      settleSeconds: body.settleSeconds ?? row?.settleSeconds ?? 60,
      onlyIfWork: body.onlyIfWork ?? row?.onlyIfWork ?? false,
      autoMerge: body.autoMerge ?? row?.autoMerge ?? false,
      concurrency: body.concurrency ?? row?.concurrency ?? 1,
      maxRunsPerHour: body.maxRunsPerHour ?? row?.maxRunsPerHour ?? 6,
      maxRunsPerDay: body.maxRunsPerDay ?? row?.maxRunsPerDay ?? 48,
      enabled: body.enabled ?? row?.enabled ?? true,
    };
  }

  /**
   * Reads `on` (#Q4231): `manual`, `event:<key>[,<key>]`, `hourly`, `6h` or
   * `daily@<utc-hour>`.
   */
  public parseOn(on: string): {
    trigger: AgentAutomation["trigger"];
    eventKeys?: string[];
    schedule?: AgentAutomation["schedule"];
    dailyHour?: number;
  } {
    const value = on.trim();
    if (value === "manual") return { trigger: "manual" };
    if (value === "hourly" || value === "6h") {
      return { trigger: "schedule", schedule: value };
    }
    const daily = /^daily@(\d{1,2})$/.exec(value);
    if (daily) {
      const hour = Number(daily[1]);
      if (hour > 23) {
        throw new BadRequestError("A daily hour is 0 to 23, in UTC");
      }
      return { trigger: "schedule", schedule: "daily", dailyHour: hour };
    }
    if (value.startsWith("event:")) {
      const keys = value
        .slice("event:".length)
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean);
      return { trigger: "event", eventKeys: keys };
    }
    throw new BadRequestError(
      `"${value}" is no trigger: manual, event:<key>[,<key>], hourly, 6h or daily@<utc-hour>`,
    );
  }

  /**
   * How a row's trigger reads in one word, the inverse of {@link parseOn}.
   */
  public onOf(
    automation: Pick<
      AgentAutomation,
      "trigger" | "eventKeys" | "schedule" | "dailyHour"
    >,
  ): string {
    if (automation.trigger === "event") {
      return `event:${(automation.eventKeys ?? []).join(",")}`;
    }
    if (automation.trigger === "schedule") {
      return automation.schedule === "daily"
        ? `daily@${automation.dailyHour ?? 0}`
        : (automation.schedule ?? "hourly");
    }
    return "manual";
  }

  /**
   * Refuses a row that cannot run: a text prompt without its words, words
   * on a prompt Lore renders, a host or agent the project does not have.
   */
  protected async validate(
    projectId: number,
    draft: ReturnType<AgentAutomationService["merged"]>,
  ): Promise<void> {
    if (draft.promptKind === "text" && !draft.promptText?.trim()) {
      throw new BadRequestError("A text automation carries its words");
    }
    if (draft.promptKind !== "text" && draft.promptText) {
      throw new BadRequestError(
        `A ${draft.promptKind} automation runs the project's own prompt: only a text automation carries words`,
      );
    }
    if ((draft.concurrency ?? 1) > 1 && draft.promptKind !== "build") {
      throw new BadRequestError(
        `Only a build automation runs several jobs at once: two ${draft.promptKind} runs would race on the same work`,
      );
    }
    if (draft.autoMerge && draft.promptKind !== "build") {
      throw new BadRequestError(
        "Only a build automation opens pull requests to merge",
      );
    }
    if (draft.onlyIfWork && draft.promptKind === "text") {
      throw new BadRequestError(
        'A text automation has no "only if there is something" check: Lore cannot tell what its words need',
      );
    }
    if (draft.trigger === "schedule") {
      if (!draft.schedule) {
        throw new BadRequestError(
          "A scheduled automation names its interval: hourly, 6h or daily",
        );
      }
      if (draft.schedule === "daily" && draft.dailyHour === undefined) {
        throw new BadRequestError(
          "A daily automation names its hour, in UTC (0 to 23)",
        );
      }
    }
    if (draft.trigger === "event") {
      if (!draft.eventKeys?.length) {
        throw new BadRequestError(
          "An event automation names the project events it listens to",
        );
      }
      const unknown = draft.eventKeys.filter((key) => !this.catalog.find(key));
      if (unknown.length) {
        throw new BadRequestError(
          `No project event ${unknown.join(", ")}: see \`lore event catalog\``,
        );
      }
    }
    if (draft.host || draft.agent) {
      await this.agents.resolve(projectId, {
        ...(draft.host ? { host: draft.host } : {}),
        ...(draft.agent ? { agent: draft.agent } : {}),
      });
    }
  }

  protected async assertNameFree(
    projectId: number,
    name: string,
  ): Promise<void> {
    const taken = await this.rows.findOne({
      where: { projectId: { eq: projectId }, name: { eq: name } },
    });
    if (taken) {
      throw new ConflictError(`An automation named "${name}" already exists`);
    }
  }
}
