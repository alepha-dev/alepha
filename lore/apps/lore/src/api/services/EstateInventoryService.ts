import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { estateInventories } from "../entities/estateInventories.ts";
import type { Estate } from "../entities/estates.ts";
import type { EstateInventoryFrame } from "../schemas/estateInventoryFrameSchema.ts";

/**
 * What Lore does with an inventory push: one row per estate, updated in
 * place.
 *
 * The split is the one `EstateStatsService` already draws. The websocket
 * endpoint owns the connection and stamps `lastSeenAt` itself, then hands
 * the validated frame here; the endpoint knows sockets and this knows what a
 * snapshot is, and the two facts do not belong in one file.
 *
 * ⚠️ Nothing here appends. A machine pushes on connect, on its tick and
 * after every command that changes state, so an append-only table would grow
 * without bound for a page that only ever shows the latest row. The upsert
 * is what keeps a push to one write whatever the app count.
 *
 * `reportedAt` is Lore's clock and `at` is the machine's, kept as a claim. A
 * host whose clock is hours off would otherwise show "measured 3 hours ago"
 * beside a `lastSeenAt` of a second ago.
 */
export class EstateInventoryService {
  protected readonly log = $logger();
  protected readonly inventories = $repository(estateInventories);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * Store what the machine reported, replacing whatever it said before.
   *
   * Read-then-write rather than a database upsert, because D1 has no
   * `ON CONFLICT DO UPDATE` through this repository and the alternative is a
   * unique-constraint failure that would drop the frame. Two pushes racing
   * would both write the same estate's row; the loser's is superseded, which
   * is what a snapshot means.
   */
  async record(estate: Estate, frame: EstateInventoryFrame): Promise<void> {
    const row = {
      at: frame.at,
      reportedAt: this.now(),
      host: frame.host,
      apps: frame.apps,
      appCount: frame.apps.length,
      ...(frame.host.bayVersion === undefined
        ? {}
        : { bayVersion: frame.host.bayVersion }),
    };

    const existing = await this.findFor(estate.id);
    if (existing) {
      await this.inventories.updateById(existing.id, row);
      return;
    }
    await this.inventories.create({ estateId: estate.id, ...row });
  }

  /**
   * The stored snapshot, or nothing for a machine that has never reported.
   *
   * Absent is a real state the console renders ("nothing reported yet"), so
   * it is answered as `undefined` rather than as an empty inventory: a host
   * with no apps and a host that never spoke are two different sentences.
   */
  async findFor(estateId: string) {
    return this.inventories.findOne({ where: { estateId: { eq: estateId } } });
  }

  protected now(): string {
    return new Date(this.dateTime.nowMillis()).toISOString();
  }
}
