import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { ForbiddenError } from "alepha/server";

import {
  type EstateCommand,
  type EstateCommandKind,
  estateCommands,
} from "../entities/estateCommands.ts";
import type { Estate } from "../entities/estates.ts";
import type { EstateCommandFrame } from "../schemas/estateCommandFrameSchema.ts";
import type { EstateCommandPayload } from "../schemas/estateCommandPayloadSchema.ts";
import { EstateCommandTransport } from "./EstateCommandTransport.ts";

/**
 * A terminal ack from the machine, or a progress one.
 */
export interface EstateCommandAck {
  id: string;
  status: "running" | "done" | "failed";
  step?: string;
  reason?: string;
}

/**
 * The queue behind the connection: enqueue, push, acknowledge, sweep.
 *
 * Built BEFORE the endpoint (#1782) and independent of it: the push goes
 * through {@link EstateCommandTransport}, which the endpoint substitutes.
 * Nothing here imports `alepha/websocket`.
 */
export class EstateCommandService {
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
   */
  public static readonly RUN_TIMEOUT_SECONDS: Record<
    EstateCommandKind,
    number
  > = {
    restart: 120,
    deploy: 900,
  };

  protected readonly log = $logger();
  protected readonly commands = $repository(estateCommands);
  protected readonly transport = $inject(EstateCommandTransport);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * Queue a command for an estate and push it if the machine is connected.
   *
   * `deploy` is refused here, server-side, while the estate's `deployAllowed`
   * switch is off: a freshly enrolled machine is stats-only until its owner
   * says otherwise. The connector refuses too (#1622), from the `welcome`
   * frame, so a Lore-side bug cannot turn a stats-only machine into a deploy
   * target either.
   */
  async enqueue(
    estate: Estate,
    input: { kind: EstateCommandKind; payload: EstateCommandPayload },
    requestedBy?: string,
  ): Promise<EstateCommand> {
    if (input.kind === "deploy" && !estate.deployAllowed) {
      throw new ForbiddenError(
        `Estate "${estate.slug}" does not accept deploys; its owner has to allow them first`,
      );
    }
    const created = await this.commands.create({
      estateId: estate.id,
      kind: input.kind,
      payload: input.payload,
      requestedBy,
      timeoutSeconds: EstateCommandService.RUN_TIMEOUT_SECONDS[input.kind],
    });
    return this.dispatch(estate, created);
  }

  /**
   * Push one command through the transport, and record `sent` if it landed.
   * A command that could not be pushed stays `pending` for the
   * reconciliation; nothing is lost by an offline machine.
   */
  async dispatch(
    estate: Estate,
    command: EstateCommand,
  ): Promise<EstateCommand> {
    const pushed = await this.transport.push(estate, this.frameOf(command));
    if (!pushed) {
      return command;
    }
    return this.markSent(command);
  }

  /**
   * Everything queued for an estate that the machine has not yet
   * acknowledged, oldest first: what the reconciliation on connect re-pushes.
   * A `sent` command is included on purpose, since "sent" only means the
   * push landed on a socket, and that socket may have died before the frame
   * was read.
   */
  async pendingFor(estateId: string): Promise<EstateCommand[]> {
    return this.commands.findMany({
      where: {
        estateId: { eq: estateId },
        status: { inArray: ["pending", "sent"] },
      },
      orderBy: [{ column: "createdAt", direction: "asc" }],
    });
  }

  /**
   * The reconciliation itself: re-push everything unacknowledged for an
   * estate, under the same ids. This is what caps a lost-in-transit command
   * at "however long the outage lasted" instead of "gone until someone
   * notices". Small, and load-bearing.
   */
  async reconcile(estate: Estate): Promise<number> {
    const waiting = await this.pendingFor(estate.id);
    let pushed = 0;
    for (const command of waiting) {
      const after = await this.dispatch(estate, command);
      if (after.status === "sent") {
        pushed += 1;
      }
    }
    return pushed;
  }

  /**
   * Record what the machine said about a command.
   *
   * Scoped to the estate that speaks: a machine can only acknowledge its own
   * commands, and an id it does not own is ignored with a log line rather
   * than refused, since nothing useful is owed to a wrong ack. An ack for a
   * command already terminal is ignored the same way: redelivery is normal,
   * and a second `done` for a command that already ran is the expected echo,
   * not a conflict.
   */
  async ack(
    estateId: string,
    ack: EstateCommandAck,
  ): Promise<EstateCommand | undefined> {
    const command = await this.commands.findOne({
      where: { id: { eq: ack.id }, estateId: { eq: estateId } },
    });
    if (!command) {
      this.log.warn("Ack for a command this estate does not hold, ignored", {
        estateId,
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
      await this.commands.updateById(command.id, {
        status: ack.status,
        finishedAt: now,
        ...(ack.step === undefined ? {} : { step: ack.step }),
        ...(ack.reason === undefined ? {} : { reason: ack.reason }),
      });
    }
    return this.commands.getOne({ where: { id: { eq: command.id } } });
  }

  /**
   * An estate's history, newest first, for its page.
   */
  async listFor(estateId: string, limit = 50): Promise<EstateCommand[]> {
    return this.commands.findMany({
      where: { estateId: { eq: estateId } },
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
      await this.commands.updateById(command.id, {
        status: "failed",
        finishedAt: new Date(now).toISOString(),
        reason,
      });
      failed += 1;
    }
    return failed;
  }

  /**
   * Keep the newest `cap` commands per estate and delete the rest, terminal
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
      const seen = kept.get(command.estateId) ?? 0;
      if (seen < cap) {
        kept.set(command.estateId, seen + 1);
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
  frameOf(command: EstateCommand): EstateCommandFrame {
    return {
      type: "command",
      id: command.id,
      kind: command.kind,
      app: command.payload.app,
      environment: command.payload.environment,
      ...(command.payload.artifact
        ? { artifact: command.payload.artifact }
        : {}),
    };
  }

  /**
   * Record that a frame reached a socket. Public because the socket handler
   * pushes the reconciliation itself, through `reply()`, and has to say so.
   */
  async markSent(command: EstateCommand): Promise<EstateCommand> {
    await this.commands.updateById(command.id, {
      status: "sent",
      sentAt: command.sentAt ?? this.now(),
    });
    return this.commands.getOne({ where: { id: { eq: command.id } } });
  }

  protected expiryReason(
    command: EstateCommand,
    now: number,
  ): string | undefined {
    if (command.status === "pending") {
      const age = now - this.millis(command.createdAt);
      return age > EstateCommandService.PENDING_TIMEOUT_SECONDS * 1000
        ? "The estate never connected to receive it"
        : undefined;
    }
    if (command.status === "sent") {
      const since = now - this.millis(command.sentAt ?? command.createdAt);
      return since > EstateCommandService.ACK_TIMEOUT_SECONDS * 1000
        ? "Never acknowledged by the estate"
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
