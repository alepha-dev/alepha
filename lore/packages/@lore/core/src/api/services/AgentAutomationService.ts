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
import type { AgentAutomationWrite } from "../schemas/agentAutomationWriteSchema.ts";
import {
  AgentAutomationKinds,
  type AgentAutomationRunOutcome,
} from "./AgentAutomationKinds.ts";
import { AgentJobs } from "./AgentJobs.ts";
import { AgentRunPreamble } from "./AgentRunPreamble.ts";
import { HostJobs } from "./HostJobs.ts";
import { ProjectDeletionService } from "./ProjectDeletionService.ts";
import { ProjectEventCatalog } from "./ProjectEventCatalog.ts";
import { ProjectSecurityService } from "./ProjectSecurityService.ts";

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
    input: { startedBy?: string; startedByJobId?: string } = {},
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
    const slots = this.concurrencyOf(automation) - active.length;
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
      // "Only if there is something" (#Q4228): a plain query before any
      // job is queued, for an event run as for a scheduled one.
      outcome =
        automation.onlyIfWork && !(await this.hasWork(automation))
          ? { jobIds: [], skipped: "Nothing to do" }
          : await this.run(automation, { startedByJobId });
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
   * How many of its jobs an automation runs at once: one.
   */
  public concurrencyOf(_automation: AgentAutomation): number {
    return 1;
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
  ): Omit<AgentAutomationWrite, "name"> & {
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
    const trigger = body.trigger ?? row?.trigger ?? "manual";
    const schedule = body.schedule ?? row?.schedule ?? undefined;
    const dailyHour = body.dailyHour ?? row?.dailyHour ?? undefined;
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
      eventKeys: body.eventKeys ?? row?.eventKeys ?? undefined,
      settleSeconds: body.settleSeconds ?? row?.settleSeconds ?? 60,
      onlyIfWork: body.onlyIfWork ?? row?.onlyIfWork ?? false,
      enabled: body.enabled ?? row?.enabled ?? true,
    };
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
