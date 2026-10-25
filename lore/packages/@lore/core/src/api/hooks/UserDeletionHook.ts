import { $hook, $inject } from "alepha";
import { NotificationInboxService } from "alepha/api/notifications";
import { $repository, DbCacheProvider, sql } from "alepha/orm";
import { ConflictError } from "alepha/server";

import { automations } from "../entities/automations.ts";
import { AutomationDatabase } from "../services/AutomationDatabase.ts";

/**
 * Refuses to delete an account that still owns projects.
 *
 * `alepha/api/users` deletes users, identities and sessions, and cannot know
 * what an application hangs off a user id — so `MyAccountController` emits
 * `user:delete:before` and awaits it, and a handler that throws aborts the
 * deletion with its own message and status.
 *
 * ### Lore needs this, and the reason is not obvious from the code
 *
 * Two of Lore's foreign keys to `users.id` make an unguarded account deletion
 * destructive, and neither is visible without reading the entity files:
 *
 * - **`projects.createdBy` is a bare `z.uuid()` with no `db.ref` at all.**
 *   There is no foreign key, so nothing cascades and nothing complains — the
 *   project simply survives pointing at an owner row that no longer exists.
 *   Every `assertOwner` on it then fails for everybody, forever. Silent, and
 *   unrecoverable without a manual `UPDATE`.
 * - **`quests.createdBy` is `onDelete: "cascade"` and NOT NULL.** Deleting the
 *   account deletes every quest that account authored — *including quests
 *   inside projects belonging to other people*. That is third-party data loss
 *   triggered by a stranger's account settings page.
 *
 * ### What this refuses, and what it deliberately does not
 *
 * It refuses on **owned projects** only. The quest cascade above is accepted
 * (decision 2026-08-14, folio #100): the delete dialog states the count before
 * the user confirms, and the two alternatives were worse. Refusing on
 * authored-quests-elsewhere too would make deletion practically impossible for
 * any active collaborator; making `quests.createdBy` nullable was verified to
 * still emit a `DROP TABLE quests` rebuild under `drizzle-kit@1.0.0-rc.4`, i.e.
 * the D1 cascade bomb (quest #277, folio #101).
 *
 * **Soft-deleted projects do not count**, and that is deliberate rather than
 * incidental. `count()` is default-scoped to live rows, so this counts what
 * the owner can still *see* — which is what makes the refusal actionable:
 * delete your projects, then your account. Counting binned rows would name a
 * number the UI shows as zero and offer no way to reach it. The stranded
 * `createdBy` left on a soft-deleted row is harmless precisely because every
 * read filters it out — nothing can `assertOwner` on a row nothing returns.
 */
export class UserDeletionHook {
  protected readonly automations = $repository(automations);
  protected readonly database = $inject(AutomationDatabase);
  protected readonly cache = $inject(DbCacheProvider);
  protected readonly inbox = $inject(NotificationInboxService);

  /**
   * Emitted without `{ log: true }` by `MyAccountController`, so the error
   * thrown here reaches the browser unwrapped — the count in this message is
   * what the person actually reads.
   *
   * ### The inbox cleanup rides here, and the order is the point
   *
   * `notification_inbox.userId` is a bare uuid with no foreign key, on
   * purpose: `alepha/api/notifications` imports nothing from
   * `alepha/api/users` and has no table to point at. So nothing cascades and
   * the app has to ask.
   *
   * It runs in **this** handler rather than its own, after the refusal above.
   * A second handler on the same event has no ordering guarantee against this
   * one, so it could delete the messages of an account whose deletion is then
   * refused — leaving a user who is still here with an inbox that has been
   * emptied under them.
   */
  onUserDelete = $hook({
    on: "user:delete:before",
    handler: async ({ userId }) => {
      // The organizations module registered its ownership refusal before
      // this application hook, so reaching this handler means deletion will
      // proceed and inbox cleanup cannot run for a refused account.
      // Live rules refuse: each one still runs as this author, and deleting
      // it is a decision for its project, made on its Automations page.
      // Refuse before any purge or inbox cleanup, so a refused deletion is
      // inert.
      const live = await this.automations.count({ authorUserId: userId });
      if (live > 0) {
        throw new ConflictError(
          `Delete your ${live} authored automation(s) from each project's Automations page, then delete your account`,
        );
      }
      await this.purgeDeletedAutomations(userId);
      await this.inbox.deleteForUser(userId);
    },
  });

  /**
   * Hard-deletes the author's soft-deleted rules, which nothing else ever
   * removes, so their restrictive author foreign key stops blocking the
   * account. Their runs, receipts and adoption markers reference the rules
   * with `ON DELETE RESTRICT` too, so the children go first, in one native
   * batch: either the whole history goes or none of it does.
   *
   * A project whose compatibility policy this author adopted and then
   * opted out of (the rule deleted, the marker kept) loses its marker here,
   * and so returns to the legacy fallback. The marker cannot outlive the
   * rule and the author it references without a schema change.
   */
  protected async purgeDeletedAutomations(userId: string): Promise<void> {
    const deleted = await this.automations.findOne(
      { where: { authorUserId: userId, deletedAt: { isNotNull: true } } },
      { force: true },
    );
    if (!deleted) return;
    const rules = sql`SELECT id FROM automations WHERE author_user_id = ${userId} AND deleted_at IS NOT NULL`;
    await this.database.batch([
      sql`DELETE FROM automation_receipts WHERE automation_id IN (${rules})`,
      sql`DELETE FROM automation_runs WHERE automation_id IN (${rules})`,
      sql`DELETE FROM automation_adoptions WHERE automation_id IN (${rules}) OR author_user_id = ${userId}`,
      sql`DELETE FROM automations WHERE author_user_id = ${userId} AND deleted_at IS NOT NULL`,
    ]);
    for (const table of [
      "automation_receipts",
      "automation_runs",
      "automation_adoptions",
      "automations",
    ])
      await this.cache.invalidateTable(table);
  }
}
