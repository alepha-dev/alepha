import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { users } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { campaigns } from "../entities/campaigns.ts";
import { quests, REMINDER_INTERVAL_MS } from "../entities/quests.ts";
import { QuestNotifications } from "../notifications/QuestNotifications.ts";

const REMINDER_BATCH = 50;

export class QuestJobs {
  protected readonly log = $logger();
  protected readonly quests = $repository(quests);
  protected readonly campaigns = $repository(campaigns);
  protected readonly users = $repository(users);
  protected readonly questNotifications = $inject(QuestNotifications);
  protected readonly dt = $inject(DateTimeProvider);

  /**
   * Send due quest reminders.
   *
   * Runs once a day at 00:00 UTC. The reminder cadence is measured in
   * days (day/week/month presets), so a single nightly sweep catches
   * every reminder that came due in the prior 24h — and because each
   * send advances `reminderNextAt` by the interval, reminders
   * self-anchor to this nightly slot after their first fire. Mail goes
   * out at night (fixed UTC hour; no per-user timezone) rather than
   * interrupting people mid-day.
   *
   * Eligibility:
   * - `reminderNextAt <= now`
   * - `acceptedBy IS NOT NULL` (someone is on the quest)
   * - `acceptedAt IS NOT NULL` and `completedAt IS NULL` (quest still
   *   open — reminders are cleared on complete/abandon, but the guard is
   *   cheap and defends against any future code path that forgets)
   * - `reminderInterval IS NOT NULL`
   *
   * Each fired reminder appends a `reminder_sent` row to the quest's
   * history (small, visible in the UI under History). Failures fall
   * through to the next sweep — the row stays scheduled.
   */
  public readonly sendDueReminders = $job({
    cron: "0 0 * * *",
    handler: async () => {
      const now = this.dt.nowISOString();
      const due = await this.quests.findMany({
        where: {
          reminderNextAt: { lte: now, isNotNull: true },
          reminderInterval: { isNotNull: true },
          acceptedBy: { isNotNull: true },
          acceptedAt: { isNotNull: true },
          completedAt: { isNull: true },
        },
        orderBy: [{ column: "reminderNextAt", direction: "asc" }],
        limit: REMINDER_BATCH,
      });
      if (due.length === 0) return;

      // Resolve recipient + campaign meta in one round-trip each. Both
      // small lookups; per-row queries would be unnecessary chatter.
      const userIds = [
        ...new Set(due.flatMap((q) => (q.acceptedBy ? [q.acceptedBy] : []))),
      ];
      const campaignIds = [...new Set(due.map((q) => q.campaignId))];

      const [recipients, campaignRows] = await Promise.all([
        userIds.length > 0
          ? this.users.findMany({ where: { id: { inArray: userIds } } })
          : Promise.resolve([]),
        campaignIds.length > 0
          ? this.campaigns.findMany({
              where: { id: { inArray: campaignIds } },
            })
          : Promise.resolve([]),
      ]);
      const userById = new Map(recipients.map((u) => [u.id, u]));
      const campaignById = new Map(campaignRows.map((c) => [c.id, c]));

      for (const quest of due) {
        try {
          if (!quest.acceptedBy || !quest.reminderInterval) continue;
          const recipient = userById.get(quest.acceptedBy);
          const campaign = campaignById.get(quest.campaignId);
          if (!recipient?.email || !campaign) {
            // Assignee deleted or no email — clear the reminder so we
            // don't keep retrying a doomed send forever.
            await this.quests.updateById(quest.id, {
              reminderNextAt: undefined,
              reminderInterval: undefined,
            });
            continue;
          }

          // Enqueue via `$notification.push` so delivery goes through the
          // framework's outbox + retry pipeline (3 retries, audit trail
          // via `record: "all"`). Calling `NotificationSenderService.send`
          // directly here would bypass all of that.
          await this.questNotifications.questReminder.push({
            contact: recipient.email,
            variables: {
              recipientName: recipient.username ?? recipient.email,
              campaignTitle: campaign.title,
              questTitle: quest.title,
              shortId: quest.shortId,
              questUrl: `/c/${campaign.id}/q/${quest.shortId}`,
            },
          });

          const nextAt = new Date(
            this.dt.nowMillis() + REMINDER_INTERVAL_MS[quest.reminderInterval],
          ).toISOString();
          await this.quests.updateById(quest.id, {
            reminderNextAt: nextAt,
            history: [
              ...quest.history,
              {
                at: this.dt.nowISOString(),
                by: quest.acceptedBy,
                action: "reminder_sent" as const,
              },
            ],
          });
        } catch (err) {
          // `.push` only fails on outbox write errors (very rare). If it
          // does, leave `reminderNextAt` in the past so the next sweep
          // retries the enqueue. Actual email delivery retries are
          // handled inside `sendNotification` ($notification module).
          this.log.warn(
            `Quest reminder for quest ${quest.id} failed to enqueue: ${String(err)}`,
          );
        }
      }
    },
  });
}
