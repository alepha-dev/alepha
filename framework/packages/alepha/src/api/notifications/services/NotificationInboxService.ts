import { $repository } from "alepha/orm";

import { notificationInboxEntity } from "../entities/notificationInboxEntity.ts";

/**
 * The two writes over `notification_inbox` that belong to nobody's request.
 *
 * The channel writes messages and the controller reads them; these are the
 * housekeeping paths, and they are here rather than on either because both
 * are called by something outside the notification flow entirely - an hourly
 * cron, and whatever hook an app runs when it deletes an account.
 */
export class NotificationInboxService {
  protected readonly repo = $repository(notificationInboxEntity);

  /**
   * Delete **read** messages older than the cutoff, in one bounded batch.
   *
   * ⚠️ Read only. An unread message is the whole point of the feature: it
   * waited for you, and a sweep that removes it before you looked has
   * deleted the thing the product exists to deliver. The consequence is
   * written on the entity: an unread inbox is unbounded for an account that
   * never opens it, and if that ever matters the fix is a second, much
   * longer window for unread rows, never a shorter one for read.
   *
   * Cutoff is on `createdAt`, the message's own age, which is the same clock
   * the receipt sweep next door uses.
   *
   * Bounded exactly like the executions sweep: select ids with a cap, then
   * delete by id. An unbounded `DELETE ... WHERE created_at < ?` over a
   * table that grows with every mention is the one statement that can time
   * an hourly D1 cron out.
   */
  public async purge(cutoff: string, limit = 5_000): Promise<number> {
    const expired = await this.repo.findMany({
      where: { readAt: { isNotNull: true }, createdAt: { lt: cutoff } },
      columns: ["id"] as any,
      limit,
    });

    if (expired.length === 0) {
      return 0;
    }

    await this.repo.deleteMany({ id: { inArray: expired.map((r) => r.id) } });
    return expired.length;
  }

  /**
   * Remove everything belonging to one account.
   *
   * ⚠️ **An app has to call this itself.** `userId` is a bare uuid with no
   * foreign key, so nothing cascades: this module imports nothing from
   * `alepha/api/users` and has no table to point at. `alepha/api/users`
   * emits `user:delete:before`, which is the seam.
   *
   * Run it **after** whatever refusal that handler already performs. A
   * separate handler that deletes first can wipe the inbox of an account
   * whose deletion is then refused, and cross-handler ordering is not
   * something to reason about twice.
   */
  public async deleteForUser(userId: string): Promise<number> {
    const removed = await this.repo.deleteMany({ userId: { eq: userId } });
    return removed.length;
  }
}
