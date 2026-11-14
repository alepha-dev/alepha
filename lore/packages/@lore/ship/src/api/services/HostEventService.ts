import { $logger } from "alepha/logger";
import { $repository, DbConflictError } from "alepha/orm";

import { type HostEvent, hostEvents } from "../entities/hostEvents.ts";
import type { Host } from "../entities/hosts.ts";
import type { HostEventFrame } from "../schemas/hostEventFrameSchema.ts";

/**
 * Stores what machines report as having happened, and reads it back.
 */
export class HostEventService {
  /**
   * How many events a host keeps. A backup an hour on a dozen apps is
   * about 300 a day, so this is a few days of a busy machine and months of a
   * quiet one; the inventory carries the current state regardless.
   */
  public static readonly KEEP_PER_HOST = 2000;

  /** The stored `data` of one event, serialised. Larger is replaced. */
  public static readonly MAX_DATA_BYTES = 8 * 1024;

  protected readonly log = $logger();
  protected readonly events = $repository(hostEvents);

  /**
   * Keep an event, once. Answers whether it was new: the same id again is
   * the machine's spool redelivering after a reconnect, not a second event.
   */
  async record(host: Host, frame: HostEventFrame): Promise<boolean> {
    const existing = await this.events.findOne({
      where: { hostId: { eq: host.id }, eventId: { eq: frame.id } },
    });
    if (existing) {
      return false;
    }
    try {
      await this.events.create({
        hostId: host.id,
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
    await this.prune(host.id);
    return true;
  }

  /**
   * The newest events of a host, or of one instance on it (machine-wide
   * events such as the bucket going down included, since they concern every
   * instance on the machine).
   */
  async list(
    hostId: string,
    filter: { app?: string; env?: string; limit?: number } = {},
  ): Promise<HostEvent[]> {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    return this.events.findMany({
      where: {
        hostId: { eq: hostId },
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

  protected bounded(frame: HostEventFrame): Record<string, unknown> {
    const size = JSON.stringify(frame.data).length;
    if (size <= HostEventService.MAX_DATA_BYTES) {
      return frame.data ?? {};
    }
    this.log.warn("An event's data was too large to keep", {
      kind: frame.kind,
      bytes: size,
    });
    return { truncated: true, bytes: size };
  }

  protected async prune(hostId: string): Promise<void> {
    const keep = HostEventService.KEEP_PER_HOST;
    const count = await this.events.count({ hostId: { eq: hostId } });
    // A little slack, so a busy machine deletes in batches rather than one
    // row per event.
    if (count <= keep + 50) {
      return;
    }
    const oldest = await this.events.findMany({
      where: { hostId: { eq: hostId } },
      orderBy: [{ column: "at", direction: "asc" }],
      limit: count - keep,
      columns: ["id"],
    });
    await this.events.deleteMany({
      id: { inArray: oldest.map((it) => it.id) },
    });
  }
}
