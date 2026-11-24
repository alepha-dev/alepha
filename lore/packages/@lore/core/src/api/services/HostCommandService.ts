import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { BadRequestError, ForbiddenError } from "alepha/server";

import { type HostCommand, hostCommands } from "../entities/hostCommands.ts";
import { hostInventories } from "../entities/hostInventories.ts";
import type { Host } from "../entities/hosts.ts";
import type { HostCommandFrame } from "../schemas/hostCommandFrameSchema.ts";
import type { HostCommandPayload } from "../schemas/hostCommandPayloadSchema.ts";
import type { HostCommandKind } from "../schemas/hostCommandValues.ts";
import { HostCommandTransport } from "./HostCommandTransport.ts";

declare module "alepha" {
  interface Hooks {
    /**
     * A command's status or step moved: an ack arrived, or the sweep failed
     * it. What a deploy row riding on that command listens to, so its status
     * follows the machine without anybody reading the page.
     */
    "host:command:progressed": {
      command: HostCommand;
      /**
       * What the machine says the result answers at, from a `done` ack
       * (#Q3155). Not stored on the command: the deploy row it rides on is
       * where an address belongs.
       */
      url?: string;
      /**
       * Where the deployed instance's `APP_SECRET` came from, and the
       * deploy's warning, from a `done` ack: said on the deploy's log.
       */
      appSecretSource?: string;
      warning?: string;
      /**
       * How a `job-run` ended, from its terminal ack (#Q3983): the command
       * row says `failed` for a timeout or a cancel, and the job row keeps
       * which one it was, with the process's exit code.
       */
      jobOutcome?: "done" | "failed" | "timed_out" | "cancelled";
      exitCode?: number;
      /** The commit a job's source resolved (#E173). */
      commit?: string;
    };
  }
}

/**
 * A terminal ack from the machine, or a progress one.
 */
export interface HostCommandAck {
  id: string;
  status: "running" | "done" | "failed" | "timed_out" | "cancelled";
  step?: string;
  reason?: string;
  /**
   * Where a deploy answers, on a `done` ack (#Q3155).
   */
  url?: string;
  appSecretSource?: string;
  warning?: string;
  exitCode?: number;
  commit?: string;
}

/**
 * The queue behind the connection: enqueue, push, acknowledge, sweep.
 *
 * Built BEFORE the endpoint (#1782) and independent of it: the push goes
 * through {@link HostCommandTransport}, which the endpoint substitutes.
 * Nothing here imports `alepha/websocket`.
 */
export class HostCommandService {
  /**
   * How long a `sent` command may wait for the machine's first ack before the
   * sweep calls it never acknowledged. A push lands on a live socket, so an
   * ack that takes longer than this means the socket died in the window
   * between the push and the machine noticing.
   */
  public static readonly ACK_TIMEOUT_SECONDS = 120;

  /**
   * How long a `pending` command waits for the machine to connect at all
   * before the sweep gives up on it. A `restart` executing a week later, on a
   * machine that finally came back, is not what anyone asked for.
   */
  public static readonly PENDING_TIMEOUT_SECONDS = 86_400;

  /**
   * How long each kind may spend `running`. A restart is a stop and a start;
   * a deploy downloads, verifies and boots, and a large artifact on a slow
   * link needs the room.
   *
   * `start` is given more than `stop` because it waits for readiness: the
   * machine's `readyTimeout` is 60 s and a cold Node boot can use most of it,
   * while a stop is one `systemctl disable --now` bounded by a 30 s grace.
   *
   * ⚠️ A number too small here is not a harmless approximation. The sweep
   * fails a `running` command past its stamp and IGNORES the later `done`, so
   * the queue would say "failed" about work the machine finished.
   *
   * The `Record<HostCommandKind, number>` type is what stops a new kind
   * shipping without one: it refuses to compile until every variant has a
   * number.
   */
  public static readonly RUN_TIMEOUT_SECONDS: Record<HostCommandKind, number> =
    {
      restart: 120,
      deploy: 900,
      // Pulls every image of the stack before Compose applies it, so the
      // longest of the deploys.
      "stack-deploy": 1800,
      stop: 120,
      start: 180,
      // ⚠️ A placeholder until `time bay backup <largest app>/production` is run
      // once on the OVH box and this is set to double it (the owner's Q3
      // ruling). `deploy`'s number, because a snapshot plus a verify plus an
      // upload is the same order of work as a download plus an unpack plus a
      // boot. Too small here is the failure that matters: the sweep marks the
      // row failed, ignores the later `done`, and the console then says a
      // backup failed while `lastBackupAt` moved.
      backup: 900,
      // A bounded tail of a journal, answered over the pull route. Short
      // because it is a read: if it has not come back in a minute, nobody is
      // still looking at the page that asked.
      logs: 60,
      // A listing of the bucket under one prefix: seconds, unless the bucket
      // is slow or down, which is what `target-probe` is for.
      "backups-list": 120,
      // Downloads the backup and opens every database in it.
      "backup-verify": 900,
      "target-probe": 60,
      "backup-policy": 60,
      // Fetches, verifies, takes a pre-restore backup, stops the app, swaps
      // the databases and starts it again.
      restore: 1800,
      // Stops one instance and unregisters it, as `stop` does plus a write.
      remove: 120,
      // `compose down` on every service of the environment.
      "stack-remove": 600,
      // A download of some tens of megabytes, a checksum, and a handoff that
      // gives the new Bay 60 s to say it is ready.
      upgrade: 300,
      // A job's own deadline is in its spec and enforced by the machine, up
      // to Bay's ceiling of four hours; this is that ceiling plus the clone
      // and a margin, so the sweep never fails a job Bay is still timing.
      "job-run": 4 * 3600 + 600,
      // A kill of a process group.
      "job-cancel": 60,
      // An `rm -rf` of a clone or two.
      "job-workspace-remove": 300,
    };

  protected readonly log = $logger();
  protected readonly commands = $repository(hostCommands);
  protected readonly inventories = $repository(hostInventories);
  protected readonly transport = $inject(HostCommandTransport);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly alepha = $inject(Alepha);

  /**
   * Refuse a command this host cannot take, before anything is written.
   *
   * Public so a caller with work to do BEFORE queueing can ask first: a Bay
   * deploy stores the copy's name ahead of the command, and a deploy the
   * host refuses must not leave a name behind.
   */
  public assertAccepts(
    host: Host,
    kind: HostCommandKind,
    payload?: HostCommandPayload,
  ): void {
    if (host.type !== "bay") {
      // The queue exists because a bay machine dials in and asks for work.
      // A cloudflare host has no connector to come for it, so without this
      // the command would sit `pending` until the sweep failed it a day
      // later as "the machine never came for it", which is a true sentence
      // about the wrong thing. Epic #1 deploys to a cloudflare host over
      // HTTP, not through this queue.
      throw new ForbiddenError(
        `Host "${host.slug}" is a Cloudflare account, which is deployed to directly rather than through the command queue`,
      );
    }
    if (
      (kind === "deploy" ||
        kind === "stack-deploy" ||
        kind === "remove" ||
        kind === "stack-remove" ||
        kind === "upgrade") &&
      !host.deployAllowed
    ) {
      throw new ForbiddenError(
        `Host "${host.slug}" does not accept deploys; its home project has to allow them first`,
      );
    }
    const writes =
      kind === "backup-policy" ||
      (kind === "restore" && !payload?.restore?.dryRun);
    if (writes && !host.deployAllowed) {
      throw new ForbiddenError(
        `Host "${host.slug}" does not accept changes to its apps; its home project has to allow deploys first`,
      );
    }
    // A workspace removal names a project and maybe one of its workspaces,
    // and no instance; held to no switch (#Q4218).
    if (kind === "job-workspace-remove") {
      if (payload && (payload.app || payload.environment || !payload.project)) {
        throw new BadRequestError(
          "A job-workspace-remove names a project and no app or environment",
        );
      }
      return;
    }
    // A job runs on its own switch, never on the deploy one (#Q3984): it
    // names no instance, a `job-run` carries the job, a `job-cancel` the run.
    if (kind === "job-run" || kind === "job-cancel") {
      if (kind === "job-run" && !host.jobsAllowed) {
        throw new ForbiddenError(
          `Host "${host.slug}" does not run jobs; its home project has to allow them first`,
        );
      }
      if (
        payload &&
        (payload.app ||
          payload.environment ||
          (kind === "job-run" ? !payload.jobId : !payload.jobCommandId))
      ) {
        throw new BadRequestError(
          kind === "job-run"
            ? "A job-run names its job and no app or environment"
            : "A job-cancel names the job-run it stops and no app or environment",
        );
      }
      return;
    }
    // The payload is one flat object for every kind, as the frame is, so
    // what each kind may carry is said here rather than by a union. An
    // `upgrade` is about the machine: a version, and no instance. Every other
    // kind names an environment.
    if (payload && kind === "upgrade") {
      if (!payload.version || payload.app || payload.environment) {
        throw new BadRequestError(
          "An upgrade names a version and no app or environment",
        );
      }
    } else if (payload && !payload.environment) {
      throw new BadRequestError(`A ${kind} names an environment`);
    }
    if (kind === "restore" && !payload?.restore?.dryRun) {
      if (!payload?.restore?.reason?.trim()) {
        throw new BadRequestError(
          "A restore replaces the app's databases and needs a reason, which the machine records with it",
        );
      }
    }
  }

  /**
   * Queue a command for a host and push it if the machine is connected.
   *
   * `deploy` is refused here, server-side, while the host's `deployAllowed`
   * switch is off: a freshly enrolled machine is stats-only until its home project
   * says otherwise. The connector refuses too (#1622), from the `welcome`
   * frame, so a Lore-side bug cannot turn a stats-only machine into a deploy
   * target either.
   */
  async enqueue(
    host: Host,
    input: { kind: HostCommandKind; payload: HostCommandPayload },
    requestedBy?: string,
  ): Promise<HostCommand> {
    this.assertAccepts(host, input.kind, input.payload);
    await this.assertNotMonitor(host);
    const created = await this.commands.create({
      hostId: host.id,
      kind: input.kind,
      payload: input.payload,
      requestedBy,
      timeoutSeconds: HostCommandService.RUN_TIMEOUT_SECONDS[input.kind],
    });
    return this.dispatch(host, created);
  }

  /**
   * Refuse every command to a monitor-only host (`bay agent`, #Q4002), which
   * its last inventory says it is. The machine refuses too, whatever it is
   * sent: this keeps a refused command out of the queue and says why at once.
   */
  protected async assertNotMonitor(host: Host): Promise<void> {
    const inventory = await this.inventories.findOne({
      where: { hostId: { eq: host.id } },
    });
    if (inventory?.machine.mode === "monitor") {
      throw new BadRequestError(
        `Host "${host.slug}" is monitor-only (bay agent): it reports and takes no command`,
      );
    }
  }

  /**
   * Push one command through the transport. `sent` is recorded first: a
   * machine can call back for the command's bundle, or ack it, before the
   * push returns, and a row still `pending` would refuse the one and write
   * over the other. A command that could not be pushed goes back to `pending`
   * for the reconciliation; nothing is lost by an offline machine.
   */
  async dispatch(host: Host, command: HostCommand): Promise<HostCommand> {
    const sent = await this.markSent(command);
    if (await this.transport.push(host, this.frameOf(command))) {
      return this.commands.getOne({ where: { id: { eq: command.id } } });
    }
    await this.commands.updateMany(
      { id: { eq: command.id }, status: { eq: "sent" } },
      { status: "pending", sentAt: command.sentAt ?? null },
    );
    return { ...sent, status: "pending", sentAt: command.sentAt };
  }

  /**
   * Everything queued for a host that the machine has not yet
   * acknowledged, oldest first: what the reconciliation on connect re-pushes.
   * A `sent` command is included on purpose, since "sent" only means the
   * push landed on a socket, and that socket may have died before the frame
   * was read.
   */
  async pendingFor(hostId: string): Promise<HostCommand[]> {
    return this.commands.findMany({
      where: {
        hostId: { eq: hostId },
        status: { inArray: ["pending", "sent"] },
      },
      orderBy: [{ column: "createdAt", direction: "asc" }],
    });
  }

  /**
   * The reconciliation itself: re-push everything unacknowledged for an
   * host, under the same ids. This is what caps a lost-in-transit command
   * at "however long the outage lasted" instead of "gone until someone
   * notices". Small, and load-bearing.
   */
  async reconcile(host: Host): Promise<number> {
    const waiting = await this.pendingFor(host.id);
    let pushed = 0;
    for (const command of waiting) {
      const after = await this.dispatch(host, command);
      if (after.status === "sent") {
        pushed += 1;
      }
    }
    return pushed;
  }

  /**
   * Record what the machine said about a command.
   *
   * Scoped to the host that speaks: a machine can only acknowledge its own
   * commands, and an id it does not own is ignored with a log line rather
   * than refused, since nothing useful is owed to a wrong ack. An ack for a
   * command already terminal is ignored the same way: redelivery is normal,
   * and a second `done` for a command that already ran is the expected echo,
   * not a conflict.
   */
  async ack(
    hostId: string,
    ack: HostCommandAck,
  ): Promise<HostCommand | undefined> {
    const command = await this.commands.findOne({
      where: { id: { eq: ack.id }, hostId: { eq: hostId } },
    });
    if (!command) {
      this.log.warn("Ack for a command this host does not hold, ignored", {
        hostId,
        commandId: ack.id,
      });
      return undefined;
    }
    if (command.status === "done" || command.status === "failed") {
      return command;
    }

    const now = this.now();
    if (ack.status === "running") {
      await this.commands.updateById(command.id, {
        status: "running",
        runningAt: command.runningAt ?? now,
        ...(ack.step === undefined ? {} : { step: ack.step }),
      });
    } else {
      // A job's timeout and cancel are failures of the command; the job row
      // keeps which one (`jobOutcome` below).
      const status = ack.status === "done" ? "done" : "failed";
      await this.commands.updateById(command.id, {
        status,
        finishedAt: now,
        ...(ack.step === undefined ? {} : { step: ack.step }),
        ...(ack.reason === undefined ? {} : { reason: ack.reason }),
      });
    }
    const updated = await this.commands.getOne({
      where: { id: { eq: command.id } },
    });
    await this.alepha.events.emit("host:command:progressed", {
      command: updated,
      ...(ack.status === "done" && ack.url ? { url: ack.url } : {}),
      ...(ack.status === "done" && ack.appSecretSource
        ? { appSecretSource: ack.appSecretSource }
        : {}),
      // A deploy's warning rides its `done`; a job's any terminal ack: a
      // worktree kept with unpushed work is said on a failed run too.
      ...((ack.status === "done" ||
        (command.kind === "job-run" && ack.status !== "running")) &&
      ack.warning
        ? { warning: ack.warning }
        : {}),
      ...(command.kind === "job-run" && ack.status !== "running"
        ? { jobOutcome: ack.status }
        : {}),
      ...(ack.exitCode === undefined ? {} : { exitCode: ack.exitCode }),
      ...(ack.commit ? { commit: ack.commit } : {}),
    });
    return updated;
  }

  /**
   * A host's history, newest first, for its page.
   */
  async listFor(hostId: string, limit = 50): Promise<HostCommand[]> {
    return this.commands.findMany({
      where: { hostId: { eq: hostId } },
      orderBy: [{ column: "createdAt", direction: "desc" }],
      limit,
    });
  }

  /**
   * Fail whatever has waited too long, so a stuck command is visible with a
   * reason rather than eternally in progress. Three rules, each reading only
   * the row: a `pending` older than {@link PENDING_TIMEOUT_SECONDS}, a `sent`
   * with no ack for {@link ACK_TIMEOUT_SECONDS}, a `running` past its own
   * `timeoutSeconds`.
   */
  async sweep(now = this.dateTime.nowMillis()): Promise<number> {
    const open = await this.commands.findMany({
      where: { status: { inArray: ["pending", "sent", "running"] } },
    });
    let failed = 0;
    for (const command of open) {
      const reason = this.expiryReason(command, now);
      if (!reason) {
        continue;
      }
      // An upgrade past its time may have happened all the same: the ack is
      // what was lost. What the host says it runs is the answer.
      const reported =
        command.kind === "upgrade" && command.status !== "pending"
          ? (
              await this.inventories.findOne({
                where: { hostId: { eq: command.hostId } },
              })
            )?.bayVersion
          : undefined;
      const reached =
        reported !== undefined && reported === command.payload.version;
      await this.commands.updateById(command.id, {
        status: reached ? "done" : "failed",
        finishedAt: new Date(now).toISOString(),
        ...(reached
          ? {}
          : {
              reason: reported
                ? `${reason}; the host reports Bay ${reported}`
                : reason,
            }),
      });
      await this.alepha.events.emit("host:command:progressed", {
        command: await this.commands.getOne({
          where: { id: { eq: command.id } },
        }),
      });
      if (!reached) {
        failed += 1;
      }
    }
    return failed;
  }

  /**
   * Keep the newest `cap` commands per host and delete the rest, terminal
   * rows only: history is bounded, an open command is never swept away by a
   * count.
   */
  async prune(cap: number): Promise<number> {
    const terminal = await this.commands.findMany({
      where: { status: { inArray: ["done", "failed"] } },
      orderBy: [{ column: "createdAt", direction: "desc" }],
    });
    const kept = new Map<string, number>();
    let pruned = 0;
    for (const command of terminal) {
      const seen = kept.get(command.hostId) ?? 0;
      if (seen < cap) {
        kept.set(command.hostId, seen + 1);
        continue;
      }
      await this.commands.deleteById(command.id);
      pruned += 1;
    }
    return pruned;
  }

  /**
   * The frame the machine receives for a command, wire format v1.
   */
  frameOf(command: HostCommand): HostCommandFrame {
    return {
      type: "command",
      id: command.id,
      kind: command.kind,
      app: command.payload.app,
      environment: command.payload.environment,
      // Bay composes a copy's instance key from it (`<project>-<app>`): dropped
      // here, the machine runs `<app>/<env>` while Lore looks the copy up, and
      // sends its backups and removal, under the name with the segment
      // (#Q3285). On a `deploy` only: a `stack-deploy` records the slug in its
      // payload, and Bay names a stack without it.
      ...((command.kind === "deploy" ||
        command.kind === "job-workspace-remove") &&
      command.payload.project
        ? { project: command.payload.project }
        : {}),
      ...(command.kind === "job-workspace-remove" && command.payload.workspace
        ? { workspace: command.payload.workspace }
        : {}),
      ...(command.payload.artifact
        ? { artifact: command.payload.artifact }
        : {}),
      ...(command.payload.stack ? { stack: command.payload.stack } : {}),
      ...(command.payload.revision
        ? { revision: command.payload.revision }
        : {}),
      ...(command.payload.routes ? { routes: command.payload.routes } : {}),
      ...(command.kind === "deploy" && command.payload.domains?.length
        ? { domains: command.payload.domains }
        : {}),
      ...(command.payload.baseDomain
        ? { baseDomain: command.payload.baseDomain }
        : {}),
      ...(command.payload.service ? { service: command.payload.service } : {}),
      ...(command.payload.tag ? { tag: command.payload.tag } : {}),
      ...(command.kind === "backup-policy"
        ? { policy: command.payload.policy ?? null }
        : {}),
      ...(command.payload.restore ? { restore: command.payload.restore } : {}),
      ...(command.payload.logs ? { logs: command.payload.logs } : {}),
      // The whole of what an upgrade is told, and on that kind only.
      ...(command.kind === "upgrade" && command.payload.version
        ? { version: command.payload.version }
        : {}),
      // The whole of what a cancel is told; a job-run is told nothing but
      // its id, and pulls its spec by it (`jobId` stays Lore's).
      ...(command.kind === "job-cancel" && command.payload.jobCommandId
        ? { jobCommandId: command.payload.jobCommandId }
        : {}),
    };
  }

  /**
   * Settle an `upgrade` the ack left open, from what the host now says it
   * runs.
   *
   * The ack is the normal path: the old Bay acks `done` once the new one
   * serves, over the connection it still holds. This is the backstop for an
   * ack lost anyway (the connection dropped at the wrong second, the old
   * process was killed). Called on every inventory.
   *
   * The version asked for is `done` whenever it is reported. Any other
   * version only fails the command when the host has CONNECTED since the
   * command was sent: before that, the inventory is the old Bay's, still
   * downloading, and says nothing about how the upgrade ended.
   */
  async settleUpgrades(host: Host, bayVersion: string | undefined) {
    if (!bayVersion) {
      return;
    }
    const open = await this.commands.findMany({
      where: {
        hostId: { eq: host.id },
        kind: { eq: "upgrade" },
        status: { inArray: ["sent", "running"] },
      },
    });
    for (const command of open) {
      const reached = bayVersion === command.payload.version;
      const since = this.millis(command.sentAt ?? command.createdAt);
      const reconnected =
        !!host.connectedAt && Date.parse(host.connectedAt) > since;
      if (!reached && !reconnected) {
        continue;
      }
      await this.commands.updateById(command.id, {
        status: reached ? "done" : "failed",
        finishedAt: this.now(),
        ...(reached
          ? {}
          : {
              reason: `The host came back on Bay ${bayVersion}, not ${command.payload.version}`,
            }),
      });
      await this.alepha.events.emit("host:command:progressed", {
        command: await this.commands.getOne({
          where: { id: { eq: command.id } },
        }),
      });
    }
  }

  /**
   * Record that a frame is going to a socket, before it goes. Public because
   * the socket handler pushes the reconciliation itself, through `reply()`,
   * and has to say so.
   */
  async markSent(command: HostCommand): Promise<HostCommand> {
    // Only what is still `pending`: a re-pushed command may be running.
    await this.commands.updateMany(
      { id: { eq: command.id }, status: { eq: "pending" } },
      { status: "sent", sentAt: command.sentAt ?? this.now() },
    );
    return this.commands.getOne({ where: { id: { eq: command.id } } });
  }

  protected expiryReason(
    command: HostCommand,
    now: number,
  ): string | undefined {
    if (command.status === "pending") {
      const age = now - this.millis(command.createdAt);
      return age > HostCommandService.PENDING_TIMEOUT_SECONDS * 1000
        ? "The host never connected to receive it"
        : undefined;
    }
    if (command.status === "sent") {
      const since = now - this.millis(command.sentAt ?? command.createdAt);
      return since > HostCommandService.ACK_TIMEOUT_SECONDS * 1000
        ? "Never acknowledged by the host"
        : undefined;
    }
    if (command.status === "running") {
      const since = now - this.millis(command.runningAt ?? command.createdAt);
      return since > command.timeoutSeconds * 1000
        ? `Timed out after ${command.timeoutSeconds} seconds`
        : undefined;
    }
    return undefined;
  }

  protected now(): string {
    return new Date(this.dateTime.nowMillis()).toISOString();
  }

  /**
   * Stamps arrive as ISO strings from the columns this service writes and
   * as whatever `db.createdAt()` yields; both read the same way here.
   */
  protected millis(value: string | number | Date): number {
    if (value instanceof Date) {
      return value.getTime();
    }
    if (typeof value === "number") {
      return value;
    }
    return Date.parse(value);
  }
}
