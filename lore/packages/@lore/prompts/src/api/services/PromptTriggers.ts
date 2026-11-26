import {
  AgentJobs,
  HostJobs,
  HourlyChecks,
  LoreDatabase,
  type ProjectEvent,
  ProjectEventCatalog,
  ProjectEventListeners,
  ProjectEvents,
  PromptRegistry,
} from "@lore/core/api";
import {
  PROMPT_CHECKS,
  PROMPT_WEEKDAYS,
  type PromptArgType,
  type PromptCheck,
  type PromptJobCause,
  type PromptResource,
  hostJobs,
  projects,
} from "@lore/core/schemas";
import { $hook, $inject, Alepha, z } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError } from "alepha/server";

import { type Prompt, prompts } from "../entities/prompts.ts";
import { PromptRunService } from "./PromptRunService.ts";
import { PromptService } from "./PromptService.ts";

/**
 * A prompt's triggers (#E174, #Q4277): E172's automation triggers, moved onto
 * the prompt, built-in or custom.
 *
 * - **Events**: a prompt listens to catalog events. An event that carries an
 *   item (its subject: `quest`, `feedback`, `epic`, `pull_request`) fills the
 *   arg of that type, one run per event and item, at once (#Q4354). A run
 *   asked for while one of the same args runs waits behind it, as one run,
 *   when the prompt's concurrency is `queue`, and is a skip when `unique`.
 * - **The settle window** (#Q4501): an event that fills no item, on a prompt
 *   whose `settleSeconds` is above 0 (triage: 300), marks the prompt
 *   pending and pushes its settle job that long after the burst's FIRST
 *   event. Later events find it pending and add nothing, so the window
 *   never restarts. When it ends, one run reads everything its sources
 *   hold. An event while a job of the prompt runs leaves it pending, and
 *   the job's end starts one follow-up. A ceiling's refusal re-arms the
 *   settle job for when the window frees up, so a refused burst is never
 *   left with nothing to pick it up.
 * - **Schedule**: hourly, every 6 hours, daily or weekly at a UTC hour, run
 *   by the existing hourly job on an indexed `nextRunAt`, claimed by a
 *   conditional write.
 * - **check**: a triggered run starts only when one of its sources holds
 *   something (`feedback`, `errors`, `quests`, `epics`), else it is a skip.
 * - **The gate**: the project's pause, a host offline (a skip, never a
 *   failure), runs per hour and per day (triggered runs only); three failed
 *   or timed-out triggered runs in a row disable it.
 * - **Guards**: a job's own events never trigger its prompt; a built-in
 *   hears only the events it accepts (`acceptsEvent`, #Q4331); the chain is
 *   one hop (AgentJobService); an event never fills a `quest` arg with a
 *   quest tagged `needs-human` or born of outside text nobody confirmed, nor
 *   a `feedback` arg with an item no member trusted.
 *
 * The run is its owner's (`createdBy`), never whoever caused the event.
 */
export class PromptTriggers {
  /**
   * How many due prompts one hourly tick reads.
   */
  public static readonly LIMIT = 100;

  /**
   * Failed or timed-out triggered runs in a row that disable a prompt.
   */
  public static readonly FAILURES = 3;

  /**
   * The arg an event's subject fills.
   */
  public static readonly SUBJECT_ARGS: Record<string, PromptArgType> = {
    quest: "quest",
    feedback: "feedback",
    epic: "epic",
    pull_request: "pullRequest",
  };

  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly rows = $repository(prompts);
  protected readonly projects = $repository(projects);
  protected readonly jobs = $repository(hostJobs);
  protected readonly registry = $inject(PromptRegistry);
  protected readonly prompts = $inject(PromptService);
  protected readonly runs = $inject(PromptRunService);
  protected readonly listeners = $inject(ProjectEventListeners);
  protected readonly checks = $inject(HourlyChecks);
  protected readonly catalog = $inject(ProjectEventCatalog);
  protected readonly events = $inject(ProjectEvents);
  protected readonly database = $inject(LoreDatabase);
  protected readonly hostJobs = $inject(HostJobs);
  protected readonly agents = $inject(AgentJobs);
  protected readonly dateTime = $inject(DateTimeProvider);

  constructor() {
    for (const definition of [
      {
        name: "prompt.disabled",
        label: "Prompt disabled",
        title: "disabled itself",
        text: "Its triggered runs failed three times in a row. Read its last job, then enable it again.",
      },
      {
        name: "prompt.ceiling.reached",
        label: "Prompt ceiling reached",
        title: "reached a ceiling",
        text: "Its triggers start nothing more until the window passes or the ceiling is raised.",
      },
    ]) {
      this.catalog.register({
        name: definition.name,
        label: definition.label,
        resource: "prompts",
        subject: "prompt",
        fields: { prompt: "text", job_id: "text", reason: "text" },
        permission: "host:read",
        // Offered only while the project has Prompts on (#E175).
        needs: { capability: "prompts" },
        message: (it) => ({
          title: `Prompt ${typeof it.prompt === "string" ? it.prompt : ""} ${definition.title}`,
          text: [
            typeof it.reason === "string" ? it.reason : "",
            definition.text,
          ]
            .filter(Boolean)
            .join(" "),
        }),
      });
    }
    this.listeners.register({
      name: "prompts",
      listens: async (projectId, event) =>
        (await this.listening(projectId, event)).length > 0,
      receive: (event) => this.receive(event),
    });
    this.checks.register({
      name: "prompts.schedule",
      run: async (now) => {
        await this.tick(now);
      },
    });
  }

  /**
   * The run waiting behind a job that ended (#Q4354), started after the
   * job's end, never inside it.
   */
  public readonly dequeue = $job({
    name: "prompts.dequeue",
    description:
      "Starts the run a prompt queued behind a job that has now ended.",
    schema: z.object({
      projectId: z.integer(),
      prompt: z.string().max(64),
      key: z.string().max(2000),
    }),
    retention: { ok: { days: 2 }, error: { days: 14 } },
    handler: async ({ payload }) => {
      await this.startQueued(payload.projectId, payload.prompt, payload.key);
    },
  });

  /**
   * The run a burst of events asked for, once its settle window ended
   * (#Q4501), or at once as the follow-up of a job that was still running.
   */
  public readonly settle = $job({
    name: "prompts.settle",
    description:
      "Starts the one run a burst of a prompt's events asked for, once its settle window ended.",
    schema: z.object({ promptId: z.uuid() }),
    retention: { ok: { days: 2 }, error: { days: 14 } },
    handler: async ({ payload }) => {
      await this.settled(payload.promptId);
    },
  });

  // ---------------------------------------------------------------------
  // The trigger as it is written
  // ---------------------------------------------------------------------

  /**
   * Reads the one `on` word: `manual`, `event:<key>[,<key>]`, `hourly`,
   * `6h`, `daily@<h>`, `weekly@<day>@<h>`, or an event part and a schedule
   * part joined by a comma (`event:quest.created,daily@7`).
   */
  public parseOn(on: string): PromptTrigger {
    const value = on.trim();
    if (value === "manual" || value === "") return {};
    const trigger: PromptTrigger = {};
    let inEvents = false;
    for (const raw of value.split(",")) {
      const part = raw.trim();
      if (!part) continue;
      const schedule = this.parseSchedule(part);
      if (schedule) {
        if (trigger.schedule) {
          throw new BadRequestError("A prompt has one schedule");
        }
        Object.assign(trigger, schedule);
        inEvents = false;
        continue;
      }
      if (part.startsWith("event:")) {
        inEvents = true;
        trigger.eventKeys = [
          ...(trigger.eventKeys ?? []),
          part.slice("event:".length).trim(),
        ].filter(Boolean);
        continue;
      }
      if (inEvents) {
        trigger.eventKeys = [...(trigger.eventKeys ?? []), part];
        continue;
      }
      throw new BadRequestError(
        `"${part}" is no trigger: manual, event:<key>[,<key>], hourly, 6h, daily@<utc-hour>, weekly@<day>@<utc-hour>, or an event part and a schedule part joined by a comma`,
      );
    }
    return trigger;
  }

  protected parseSchedule(part: string): PromptTrigger | undefined {
    if (part === "hourly" || part === "6h") return { schedule: part };
    const daily = /^daily@(\d{1,2})$/.exec(part);
    if (daily) {
      return { schedule: "daily", dailyHour: this.hour(daily[1]!) };
    }
    const weekly = /^weekly@([a-z]{3})@(\d{1,2})$/.exec(part);
    if (weekly) {
      const weekday = (PROMPT_WEEKDAYS as readonly string[]).indexOf(
        weekly[1]!,
      );
      if (weekday < 0) {
        throw new BadRequestError(
          `A weekday is one of ${PROMPT_WEEKDAYS.join(", ")}`,
        );
      }
      return {
        schedule: "weekly",
        weekday,
        dailyHour: this.hour(weekly[2]!),
      };
    }
    return undefined;
  }

  protected hour(raw: string): number {
    const hour = Number(raw);
    if (hour > 23) throw new BadRequestError("An hour is 0 to 23, in UTC");
    return hour;
  }

  /**
   * How a row's trigger reads in one word, the inverse of {@link parseOn}.
   */
  public onOf(
    row: Pick<Prompt, "eventKeys" | "schedule" | "dailyHour" | "weekday">,
  ): string {
    const parts: string[] = [];
    if (row.eventKeys?.length) parts.push(`event:${row.eventKeys.join(",")}`);
    if (row.schedule === "daily") parts.push(`daily@${row.dailyHour ?? 0}`);
    else if (row.schedule === "weekly") {
      parts.push(
        `weekly@${PROMPT_WEEKDAYS[row.weekday ?? 1]}@${row.dailyHour ?? 0}`,
      );
    } else if (row.schedule) parts.push(row.schedule);
    return parts.length ? parts.join(",") : "manual";
  }

  /**
   * The next run of a schedule after `now`, on the hour in UTC.
   */
  public nextRunAfter(
    row: Pick<Prompt, "schedule" | "dailyHour" | "weekday">,
    now: number,
  ): string | undefined {
    if (!row.schedule) return undefined;
    const hour = 3_600_000;
    let next = Math.floor(now / hour) * hour + hour;
    const fits = (at: number) => {
      const date = new Date(at);
      const h = date.getUTCHours();
      if (row.schedule === "6h") return h % 6 === 0;
      if (row.schedule === "daily") return h === (row.dailyHour ?? 0);
      if (row.schedule === "weekly") {
        return (
          h === (row.dailyHour ?? 0) && date.getUTCDay() === (row.weekday ?? 1)
        );
      }
      return true;
    };
    while (!fits(next)) next += hour;
    return new Date(next).toISOString();
  }

  /**
   * The columns a trigger write sets, checked against the prompt: known
   * events, every arg filled (by the event, or by a stored value), and an
   * event whose item the prompt cannot take refused when it leaves an arg
   * empty.
   */
  public patch(
    prompt: PromptResource,
    row: Prompt | undefined,
    body: PromptTriggerWrite,
  ): Partial<Prompt> {
    const patch: Partial<Prompt> = {};
    const trigger =
      body.on === undefined
        ? {
            eventKeys: row?.eventKeys ?? undefined,
            schedule: row?.schedule ?? undefined,
            dailyHour: row?.dailyHour ?? undefined,
            weekday: row?.weekday ?? undefined,
          }
        : this.parseOn(body.on);
    const argValues =
      body.argValues === undefined
        ? (row?.argValues ?? {})
        : Object.fromEntries(
            Object.entries(body.argValues ?? {}).filter(([, it]) => it),
          );
    for (const key of trigger.eventKeys ?? []) {
      if (!this.catalog.find(key)) {
        throw new BadRequestError(
          `Unknown event "${key}": see the event catalog`,
        );
      }
    }
    for (const [name, value] of Object.entries(argValues)) {
      const arg = prompt.args.find((it) => it.name === name);
      if (!arg) {
        throw new BadRequestError(`The prompt has no arg '${name}'`);
      }
      // A choice's stored value is one of its options (#Q4415), refused
      // here rather than at the first triggered run.
      if (arg.type === "choice" && !(arg.accepts ?? []).includes(value)) {
        throw new BadRequestError(
          `The arg '${name}' is one of ${(arg.accepts ?? []).join(", ")}, not '${value}'`,
        );
      }
    }
    if (trigger.eventKeys?.length || trigger.schedule) {
      // A choice needs no stored value: a triggered run takes its first
      // option (#Q4415).
      const stored = (arg: { name: string; type: string }) =>
        !!argValues[arg.name] || arg.type === "choice";
      if (trigger.schedule) {
        const empty = prompt.args.find((arg) => !stored(arg));
        if (empty) {
          throw new BadRequestError(
            `A schedule leaves the arg '${empty.name}' (${empty.type}) empty: store a value for it`,
          );
        }
      }
      for (const key of trigger.eventKeys ?? []) {
        const subject = this.catalog.find(key)?.subject ?? "";
        const fills = PromptTriggers.SUBJECT_ARGS[subject];
        const empty = prompt.args.find(
          (arg) => !stored(arg) && arg.type !== fills,
        );
        if (empty) {
          throw new BadRequestError(
            `The event "${key}" leaves the arg '${empty.name}' (${empty.type}) empty: store a value for it, or choose an event that carries one`,
          );
        }
      }
    }
    if (body.on !== undefined) {
      const now = this.dateTime.nowMillis();
      const same =
        row?.schedule === trigger.schedule &&
        row?.dailyHour === trigger.dailyHour &&
        row?.weekday === trigger.weekday;
      Object.assign(patch, {
        eventKeys: trigger.eventKeys?.length ? trigger.eventKeys : null,
        schedule: trigger.schedule ?? null,
        dailyHour: trigger.dailyHour ?? null,
        weekday: trigger.weekday ?? null,
        nextRunAt: trigger.schedule
          ? same && row?.nextRunAt
            ? row.nextRunAt
            : (this.nextRunAfter(trigger, now) ?? null)
          : null,
      });
    }
    if (body.argValues !== undefined) patch.argValues = argValues;
    if (body.check !== undefined) {
      patch.check = (
        (body.check ?? []).length ? body.check : null
      ) as Prompt["check"];
    }
    if (body.maxRunsPerHour !== undefined) {
      patch.maxRunsPerHour = body.maxRunsPerHour;
    }
    if (body.maxRunsPerDay !== undefined) {
      patch.maxRunsPerDay = body.maxRunsPerDay;
    }
    if (body.settleSeconds !== undefined) {
      patch.settleSeconds = body.settleSeconds as number;
    }
    // Enabled again by hand: a fresh count.
    if (body.enabled === true) patch.consecutiveFailures = 0;
    return patch;
  }

  // ---------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------

  /**
   * The project's enabled prompts listening to an event: none while the
   * project has Prompts off (#Q4314), read when the event fires, since the
   * switch may flip between two events.
   */
  public async listening(projectId: number, event: string): Promise<Prompt[]> {
    if (!(await this.agents.isOn(projectId))) return [];
    const rows = await this.rows.findMany({
      where: { projectId: { eq: projectId }, enabled: { eq: true } },
    });
    return rows.filter((row) => row.eventKeys?.includes(event));
  }

  /**
   * One event, for every prompt of its project that listens to it.
   */
  public async receive(event: ProjectEvent): Promise<void> {
    const listening = await this.listening(event.projectId, event.name);
    if (!listening.length) return;
    const raisedBy = event.jobId
      ? await this.jobs.findOne({ where: { id: { eq: event.jobId } } })
      : undefined;
    for (const row of listening) {
      // A job's own events never trigger the prompt that started it.
      if (raisedBy?.prompt === row.name) continue;
      // An event the built-in declines is not for it (#Q4331): no run, no
      // skip recorded.
      const builtin = row.builtin ? this.registry.get(row.name) : undefined;
      if (builtin?.acceptsEvent && !(await builtin.acceptsEvent(event))) {
        continue;
      }
      const prompt = await this.prompts
        .get(row.projectId, row.name)
        .catch(() => undefined);
      if (!prompt) continue;
      const fills = PromptTriggers.SUBJECT_ARGS[event.subjectKind];
      const arg = fills
        ? prompt.args.find((it) => it.type === fills)
        : undefined;
      const cause: PromptJobCause = { kind: "event", event: event.name };
      // An event that fills no item waits out the prompt's settle window,
      // with the rest of its burst (#Q4501).
      if (!(arg && event.subjectId) && this.settleOf(row) > 0) {
        await this.ask(row, event);
        continue;
      }
      // At once: one run per event and item, or, with no item, a run that
      // waits behind the running one as one (#Q4354).
      await this.runTriggered(
        row,
        cause,
        arg && event.subjectId ? { [arg.name]: event.subjectId } : {},
        event.jobId ?? undefined,
      );
    }
  }

  /**
   * The prompt's settle window in seconds (#Q4501): its own, else its
   * built-in's, else 0.
   */
  public settleOf(row: Pick<Prompt, "builtin" | "name" | "settleSeconds">) {
    if (typeof row.settleSeconds === "number") return row.settleSeconds;
    if (!row.builtin) return 0;
    return this.registry.get(row.name)?.settleSeconds ?? 0;
  }

  /**
   * Marks the prompt pending and, on a burst's first event only, pushes its
   * settle job `settleSeconds` later: an event that finds it pending adds
   * nothing, so the window does not restart.
   */
  protected async ask(row: Prompt, event: ProjectEvent): Promise<void> {
    const claimed = await this.rows.updateMany(
      { id: { eq: row.id }, pending: { eq: false } },
      {
        pending: true,
        pendingEvent: event.name,
        pendingAt: this.dateTime.nowISOString(),
        ...(event.jobId
          ? { pendingJobId: event.jobId }
          : { pendingJobId: null as never }),
      },
    );
    if (this.count(claimed) === 0) {
      // Already pending. An event a member caused makes the burst theirs:
      // the run is no longer a job's follow-up, so the chain guard does not
      // hold back what they asked for.
      if (!event.jobId) {
        await this.rows.updateMany(
          { id: { eq: row.id }, pending: { eq: true } },
          { pendingJobId: null as never },
        );
      }
      return;
    }
    await this.settle.push(
      { promptId: row.id },
      {
        key: `settle:${row.id}:${event.id}`,
        delay: [this.settleOf(row), "seconds"],
      },
    );
  }

  /**
   * The settled run: one run over everything the prompt's sources hold,
   * unless a job of the prompt still runs (its end starts it). A ceiling's
   * refusal leaves the prompt pending and pushes the settle job again for
   * when the window frees up.
   */
  public async settled(promptId: string): Promise<void> {
    const row = await this.rows.findOne({ where: { id: { eq: promptId } } });
    if (!row?.pending) return;
    if (
      !row.enabled ||
      !row.eventKeys?.length ||
      !(await this.agents.isOn(row.projectId))
    ) {
      await this.clear(row.id);
      return;
    }
    if (await this.active(row)) return;
    if (!(await this.clear(row.id))) return;
    const outcome = await this.runTriggered(
      row,
      { kind: "event", event: row.pendingEvent ?? row.eventKeys[0]! },
      {},
      row.pendingJobId ?? undefined,
    );
    if (outcome.retryAt) await this.rearm(row, outcome.retryAt);
  }

  /**
   * Puts a refused burst back to pending, its settle job pushed for `at`.
   */
  protected async rearm(row: Prompt, at: number): Promise<void> {
    const claimed = await this.rows.updateMany(
      { id: { eq: row.id }, pending: { eq: false } },
      {
        pending: true,
        pendingAt: this.dateTime.nowISOString(),
        ...(row.pendingEvent ? { pendingEvent: row.pendingEvent } : {}),
        ...(row.pendingJobId ? { pendingJobId: row.pendingJobId } : {}),
      },
    );
    if (this.count(claimed) === 0) return;
    const seconds = Math.max(
      1,
      Math.ceil((at - this.dateTime.nowMillis()) / 1000),
    );
    await this.settle.push(
      { promptId: row.id },
      { key: `settle:${row.id}:retry:${at}`, delay: [seconds, "seconds"] },
    );
  }

  protected async active(row: Prompt): Promise<boolean> {
    const running = await this.jobs.findOne({
      where: {
        projectId: { eq: row.projectId },
        prompt: { eq: row.name },
        status: { inArray: ["queued", "running"] },
      },
    });
    return !!running;
  }

  protected async clear(promptId: string): Promise<boolean> {
    const cleared = await this.rows.updateMany(
      { id: { eq: promptId }, pending: { eq: true } },
      {
        pending: false,
        pendingJobId: null as never,
        pendingEvent: null as never,
        pendingAt: null as never,
      },
    );
    return this.count(cleared) > 0;
  }

  /**
   * Starts the run waiting for these arg values, unless a job of them still
   * runs: then that job's end starts it. Taken by one caller only. A run by
   * hand runs as the member who asked; a triggered one goes through the
   * trigger's gate again, as its owner.
   */
  public async startQueued(
    projectId: number,
    name: string,
    key: string,
  ): Promise<void> {
    if (await this.runs.activeJob(projectId, name, key)) return;
    const entry = await this.runs.take(projectId, name, key);
    if (!entry?.userId) return;
    if (!(await this.agents.isOn(projectId))) return;
    const body = {
      ...(entry.args ? { args: entry.args } : {}),
      ...(entry.host ? { host: entry.host } : {}),
      ...(entry.agent ? { agent: entry.agent } : {}),
      ...(entry.model ? { model: entry.model } : {}),
    };
    if (entry.cause.kind === "hand") {
      await this.runs
        .run(
          projectId,
          { id: entry.userId, roles: ["user"] },
          name,
          body,
          entry.cause,
          entry.startedByJobId ?? undefined,
        )
        .catch((error) =>
          this.log.warn("A queued run by hand could not start", {
            prompt: name,
            error,
          }),
        );
      return;
    }
    const row = await this.rows.findOne({
      where: { projectId: { eq: projectId }, name: { eq: name } },
    });
    if (!row?.enabled) return;
    await this.runTriggered(
      row,
      entry.cause,
      entry.args ?? {},
      entry.startedByJobId ?? undefined,
    );
  }

  // ---------------------------------------------------------------------
  // Schedule
  // ---------------------------------------------------------------------

  /**
   * Runs every scheduled prompt due at `now`. Answers how many started.
   *
   * A project with Prompts off (#Q4314) has its due rows moved to their next
   * run and nothing started: checked at fire time, since the switch can
   * flip between two ticks, and moved on so its rows never hold the tick's
   * limit from the projects that have it on.
   */
  public async tick(now: string): Promise<number> {
    const due = await this.rows.findMany({
      where: { nextRunAt: { lte: now } },
      orderBy: [{ column: "nextRunAt", direction: "asc" }],
      limit: PromptTriggers.LIMIT,
    });
    let started = 0;
    for (const row of due) {
      if (!row.schedule || !row.enabled) continue;
      const claimed = await this.rows.updateMany(
        { id: { eq: row.id }, nextRunAt: { eq: row.nextRunAt as string } },
        {
          nextRunAt: this.nextRunAfter(row, new Date(now).getTime()) as string,
        },
      );
      if (this.count(claimed) === 0) continue;
      if (!(await this.agents.isOn(row.projectId))) continue;
      const outcome = await this.runTriggered(row, { kind: "schedule" }, {});
      if (outcome.jobId) started++;
    }
    return started;
  }

  // ---------------------------------------------------------------------
  // A triggered run
  // ---------------------------------------------------------------------

  /**
   * A run a trigger started, as the prompt's owner, never thrown: a refusal
   * is a skip recorded on the row, so the event or the tick that caused it
   * is not retried into the same refusal.
   */
  public async runTriggered(
    row: Prompt,
    cause: PromptJobCause,
    filled: Record<string, string>,
    startedByJobId?: string,
  ): Promise<PromptTriggeredOutcome> {
    let outcome: PromptTriggeredOutcome;
    try {
      outcome = await this.attempt(row, cause, filled, startedByJobId);
    } catch (error) {
      outcome = {
        skipped: error instanceof Error ? error.message : "The run was refused",
      };
    }
    if (outcome.jobId) {
      await this.rows.updateById(row.id, {
        lastRunAt: this.dateTime.nowISOString(),
        lastJobId: outcome.jobId,
      });
    } else if (outcome.skipped) {
      this.log.info("A prompt's triggered run started nothing", {
        prompt: row.name,
        reason: outcome.skipped,
      });
      await this.rows.updateById(row.id, {
        lastSkippedAt: this.dateTime.nowISOString(),
        lastSkippedReason: outcome.skipped.slice(0, 500),
      });
    }
    return outcome;
  }

  protected async attempt(
    row: Prompt,
    cause: PromptJobCause,
    filled: Record<string, string>,
    startedByJobId?: string,
  ): Promise<PromptTriggeredOutcome> {
    if (!row.createdBy) {
      return {
        skipped:
          "This prompt's owner is no longer a member: a member takes it over by editing its trigger",
      };
    }
    const gate = await this.gate(row);
    if (gate) return gate;
    if (!(await this.hasWork(row))) return { skipped: "Nothing to do" };
    const prompt = await this.prompts.get(row.projectId, row.name);
    for (const arg of prompt.args) {
      const value = filled[arg.name];
      if (!value) continue;
      const refusal = await this.registry
        .arg(arg.type)
        ?.triggerRefusal?.(row.projectId, value);
      if (refusal) return { skipped: refusal };
    }
    const owner: UserAccountToken = { id: row.createdBy, roles: ["user"] };
    // An event or a schedule cannot pick a choice: a choice with no stored
    // value takes its first option (#Q4415).
    const defaults = Object.fromEntries(
      prompt.args
        .filter((arg) => arg.type === "choice" && arg.accepts?.[0])
        .map((arg) => [arg.name, arg.accepts![0]!]),
    );
    const out = await this.runs.run(
      row.projectId,
      owner,
      row.name,
      { args: { ...defaults, ...row.argValues, ...filled } },
      cause,
      startedByJobId,
    );
    // Queued behind a running job: its end starts it, nothing to record yet.
    return out.jobId ? { jobId: out.jobId } : {};
  }

  /**
   * What stops a triggered run before a host is asked: the project's pause,
   * its host offline or gone (a skip, never a failure), and the ceilings.
   */
  protected async gate(
    row: Prompt,
  ): Promise<{ skipped: string; retryAt?: number } | undefined> {
    const project = await this.projects.findOne({
      where: { id: { eq: row.projectId } },
    });
    if (!(await this.agents.isOn(row.projectId))) {
      return { skipped: "Prompts is off in this project" };
    }
    if (project?.promptsPausedAt) {
      return { skipped: "Prompts' triggers are paused in this project" };
    }
    try {
      const { host } = await this.agents.resolve(row.projectId, {
        ...(row.host ? { host: row.host } : {}),
        ...(row.agent ? { agent: row.agent } : {}),
        firstAgent: true,
      });
      if (host.offline) return { skipped: `Host "${host.slug}" is offline` };
      if (host.status && host.status !== "available") {
        return { skipped: `Host "${host.slug}" is ${host.status}` };
      }
    } catch (error) {
      return {
        skipped: error instanceof Error ? error.message : "No Agent host",
      };
    }
    const now = this.dateTime.nowMillis();
    const since = (ms: number) => new Date(now - ms).toISOString();
    const triggered = await this.triggeredSince(row, since(86_400_000));
    const hour = triggered.filter((at) => at >= since(3_600_000)).length;
    // When the oldest run counted leaves the window, a run fits again.
    const frees = (window: number, times: string[]) =>
      Math.min(...times.map((at) => new Date(at).getTime())) + window;
    if (hour >= row.maxRunsPerHour) {
      return {
        skipped: await this.ceiling(
          row,
          `Ceiling reached: ${row.maxRunsPerHour} triggered runs in the last hour`,
        ),
        retryAt: frees(
          3_600_000,
          triggered.filter((at) => at >= since(3_600_000)),
        ),
      };
    }
    if (triggered.length >= row.maxRunsPerDay) {
      return {
        skipped: await this.ceiling(
          row,
          `Ceiling reached: ${row.maxRunsPerDay} triggered runs in the last day`,
        ),
        retryAt: frees(86_400_000, triggered),
      };
    }
    return undefined;
  }

  /**
   * When the prompt's triggered runs since `since` were queued.
   */
  protected async triggeredSince(
    row: Prompt,
    since: string,
  ): Promise<string[]> {
    const jobs = await this.jobs.findMany({
      where: {
        projectId: { eq: row.projectId },
        prompt: { eq: row.name },
        queuedAt: { gte: since },
      },
    });
    return jobs
      .filter((job) => job.cause && job.cause.kind !== "hand")
      .map((job) => job.queuedAt);
  }

  /**
   * Records a ceiling's refusal with `prompt.ceiling.reached`, once per
   * stretch: a second refusal for the same reason tells nobody again.
   */
  protected async ceiling(row: Prompt, reason: string): Promise<string> {
    if (row.lastSkippedReason !== reason) {
      await this.raise(row, "prompt.ceiling.reached", { reason }).catch(
        (error) =>
          this.log.warn("A prompt's ceiling could not be recorded", {
            prompt: row.name,
            error,
          }),
      );
    }
    return reason;
  }

  /**
   * Whether one of the prompt's `check` sources has something to do. No
   * `check`, always.
   */
  public async hasWork(
    row: Pick<Prompt, "check" | "projectId">,
  ): Promise<boolean> {
    if (!row.check?.length) return true;
    for (const source of row.check) {
      const check = this.registry.check(source);
      if (check && (await check(row.projectId))) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------
  // Health, and the run waiting behind a job
  // ---------------------------------------------------------------------

  protected readonly onJobEnded = $hook({
    on: "host:job:ended",
    handler: async ({ job }) => {
      if (!job.prompt) return;
      // The run waiting behind this one starts now (#Q4354), a built-in
      // with no row included.
      await this.dequeue.push(
        {
          projectId: job.projectId,
          prompt: job.prompt,
          key: PromptRunService.keyOf(job.args),
        },
        { key: `dequeue:${job.id}` },
      );
      const row = await this.rows.findOne({
        where: {
          projectId: { eq: job.projectId },
          name: { eq: job.prompt },
        },
      });
      if (!row) return;
      // Events arrived while it ran: their one follow-up starts once their
      // window is over (#Q4501), at once if it already is, never earlier:
      // the rest of the burst still lands in that one run.
      if (row.pending) {
        const ends = row.pendingAt
          ? Date.parse(row.pendingAt) + this.settleOf(row) * 1000
          : 0;
        const wait = Math.ceil((ends - this.dateTime.nowMillis()) / 1000);
        await this.settle.push(
          { promptId: row.id },
          {
            key: `settle:${row.id}:after:${job.id}`,
            ...(wait > 0
              ? { delay: [wait, "seconds"] as [number, "seconds"] }
              : {}),
          },
        );
      }
      if (!job.cause || job.cause.kind === "hand") return;
      if (job.status === "succeeded") {
        if (row.consecutiveFailures > 0) {
          await this.rows.updateById(row.id, { consecutiveFailures: 0 });
        }
        return;
      }
      if (job.status !== "failed" && job.status !== "timed_out") return;
      const failures = row.consecutiveFailures + 1;
      const claimed = await this.rows.updateMany(
        {
          id: { eq: row.id },
          consecutiveFailures: { eq: row.consecutiveFailures },
        },
        { consecutiveFailures: failures },
      );
      if (this.count(claimed) === 0) return;
      if (!row.enabled || failures < PromptTriggers.FAILURES) return;
      const reason =
        job.reason ??
        (job.status === "timed_out" ? "The job timed out" : "The job failed");
      await this.rows.updateById(row.id, {
        enabled: false,
        lastSkippedAt: job.endedAt ?? job.queuedAt,
        lastSkippedReason:
          `Disabled after ${failures} failed runs in a row: ${reason}`.slice(
            0,
            500,
          ),
      });
      await this.raise(row, "prompt.disabled", {
        reason: reason.slice(0, 500),
        job_id: job.id,
      });
    },
  });

  protected async raise(
    row: Prompt,
    name: "prompt.disabled" | "prompt.ceiling.reached",
    fields: { reason: string; job_id?: string },
  ): Promise<void> {
    const project = await this.projects.findOne({
      where: { id: { eq: row.projectId } },
    });
    const recorded = await this.events.emit({
      projectId: row.projectId,
      name,
      subjectId: row.name,
      fields: {
        project: project?.title,
        title: row.name,
        prompt: row.name,
        ...fields,
        url: `/${project?.slug || `project-${row.projectId}`}/settings/prompts`,
      },
    });
    await this.database.batch(recorded.statements);
    await recorded.committed();
  }

  // ---------------------------------------------------------------------
  // The pause
  // ---------------------------------------------------------------------

  public async setPaused(projectId: number, paused: boolean): Promise<void> {
    await this.projects.updateById(projectId, {
      promptsPausedAt: (paused ? this.dateTime.nowISOString() : null) as never,
    });
  }

  public async pausedAt(projectId: number): Promise<string | undefined> {
    const project = await this.projects.findOne({
      where: { id: { eq: projectId } },
    });
    return project?.promptsPausedAt ?? undefined;
  }

  protected count(result: unknown): number {
    if (Array.isArray(result)) return result.length;
    return result ? 1 : 0;
  }

  /**
   * The checks a project's prompts may list.
   */
  public static readonly CHECKS: readonly PromptCheck[] = PROMPT_CHECKS;
}

/**
 * What a triggered run did: the job it started, or why it started nothing,
 * and, for a ceiling, when a run fits again.
 */
export interface PromptTriggeredOutcome {
  jobId?: string;
  skipped?: string;
  retryAt?: number;
}

/**
 * A trigger as `on` reads: its events, and its schedule.
 */
export interface PromptTrigger {
  eventKeys?: string[];
  schedule?: Prompt["schedule"];
  dailyHour?: number;
  weekday?: number;
}

/**
 * The trigger fields a write sets.
 */
export interface PromptTriggerWrite {
  on?: string;
  check?: PromptCheck[] | null;
  argValues?: Record<string, string> | null;
  maxRunsPerHour?: number;
  maxRunsPerDay?: number;
  settleSeconds?: number | null;
  enabled?: boolean;
}
