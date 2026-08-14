import { $hook, z } from "alepha";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, ConflictError } from "alepha/server";
import { projects } from "../entities/projects.ts";
import { quests } from "../entities/quests.ts";

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
  protected readonly projects = $repository(projects);
  protected readonly quests = $repository(quests);

  /**
   * Emitted without `{ log: true }` by `MyAccountController`, so the error
   * thrown here reaches the browser unwrapped — the count in this message is
   * what the person actually reads.
   */
  onUserDelete = $hook({
    on: "user:delete:before",
    handler: async ({ userId }) => {
      const owned = await this.projects.count({ createdBy: { eq: userId } });

      if (owned > 0) {
        throw new ConflictError(
          owned === 1
            ? "You still own 1 project. Delete it before deleting your account."
            : `You still own ${owned} projects. Delete them before deleting your account.`,
        );
      }
    },
  });

  /**
   * How many quests this account authored that its deletion would take with it.
   *
   * `quests.createdBy` is `onDelete: "cascade"`, so those quests go — including
   * ones inside projects belonging to other people. The hook does not refuse on
   * them (see above), which makes stating the number before the click the only
   * thing standing between the person and a surprise. The account page reads
   * this to fill `AccountSecurityProps.deleteWarning`.
   *
   * A question, not a decision — which is why it is an action beside the hook
   * rather than part of it.
   */
  countMyAuthoredQuests = $action({
    method: "GET",
    path: "/users/me/authored-quests",
    use: [$secure()],
    description: "How many quests the caller authored",
    schema: {
      response: z.object({ count: z.integer() }),
    },
    handler: async ({ user }) => ({
      count: await this.quests.count({ createdBy: { eq: user.id } }),
    }),
  });
}
