import { $logger } from "alepha/logger";
import { $repository, DbConflictError } from "alepha/orm";

import { type EstateEvent, estateEvents } from "../entities/estateEvents.ts";
import type { Estate } from "../entities/estates.ts";
import type { EstateEventFrame } from "../schemas/estateEventFrameSchema.ts";

/**
 * Stores what machines report as having happened, and reads it back.
 */
export class EstateEventService {
  /**
   * How many events an estate keeps. A backup an hour on a dozen apps is
   * about 300 a day, so this is a few days of a busy machine and months of a
   * quiet one; the inventory carries the current state regardless.
   */
  public static readonly KEEP_PER_ESTATE = 2000;

  /** The stored `data` of one event, serialised. Larger is replaced. */
  public static readonly MAX_DATA_BYTES = 8 * 1024;

  protected readonly log = $logger();
  protected readonly events = $repository(estateEvents);

  /**
   * Keep an event, once. Answers whether it was new: the same id again is
   * the machine's spool redelivering after a reconnect, not a second event.
   */
  async record(estate: Estate, frame: EstateEventFrame): Promise<boolean> {
    const existing = await this.events.findOne({
      where: { estateId: { eq: estate.id }, eventId: { eq: frame.id } },
    });
    if (existing) {
      return false;
    }
    try {
      await this.events.create({
        estateId: estate.id,
        eventId: frame.id,
        kind: frame.kind,
        at: frame.at,
        ...(frame.app ? { app: frame.app } : {}),
        ...(frame.env ? { env: frame.env } : {}),
        ...(frame.data ? { data: this.bounded(frame) } : {}),
      });
    } catch (error) {
      // Two deliveries of one event raced past the lookup: the unique index
      // kept the first, so this one is the duplicate, not a failure.
      if (error instanceof DbConflictError) {
        return false;
      }
      throw error;
    }
    await this.prune(estate.id);
    return true;
  }

  /**
   * The newest events of an estate, or of one instance on it (machine-wide
   * events such as the bucket going down included, since they concern every
   * instance on the machine).
   */
  async list(
    estateId: string,
    filter: { app?: string; env?: string; limit?: number } = {},
  ): Promise<EstateEvent[]> {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    return this.events.findMany({
      where: {
        estateId: { eq: estateId },
        ...(filter.app
          ? {
              or: [
                { app: { isNull: true } },
                {
                  app: { eq: filter.app },
                  ...(filter.env ? { env: { eq: filter.env } } : {}),
                },
              ],
            }
          : {}),
      },
      orderBy: [{ column: "at", direction: "desc" }],
      limit,
    });
  }

  protected bounded(frame: EstateEventFrame): Record<string, unknown> {
    const size = JSON.stringify(frame.data).length;
    if (size <= EstateEventService.MAX_DATA_BYTES) {
      return frame.data ?? {};
    }
    this.log.warn("An event's data was too large to keep", {
      kind: frame.kind,
      bytes: size,
    });
    return { truncated: true, bytes: size };
  }

  protected async prune(estateId: string): Promise<void> {
    const keep = EstateEventService.KEEP_PER_ESTATE;
    const count = await this.events.count({ estateId: { eq: estateId } });
    // A little slack, so a busy machine deletes in batches rather than one
    // row per event.
    if (count <= keep + 50) {
      return;
    }
    const oldest = await this.events.findMany({
      where: { estateId: { eq: estateId } },
      orderBy: [{ column: "at", direction: "asc" }],
      limit: count - keep,
      columns: ["id"],
    });
    await this.events.deleteMany({
      id: { inArray: oldest.map((it) => it.id) },
    });
  }
}
