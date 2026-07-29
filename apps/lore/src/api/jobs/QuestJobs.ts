import { $inject, Alepha } from "alepha";
import { $job } from "alepha/api/jobs";
import { users } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { campaigns } from "../entities/campaigns.ts";
import { quests, REMINDER_INTERVAL_MS } from "../entities/quests.ts";
import { QuestNotifications } from "../notifications/QuestNotifications.ts";
import { relations } from "../relations.ts";

const REMINDER_BATCH = 50;

export class QuestJobs {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly quests = $repository(quests);
  /** ...with the assignee and campaign a reminder email needs. */
  protected readonly questsWith = $repository(relations, "quests");
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
      // The assignee and the campaign come back with the quest, so the batch
      // is one statement rather than three.
      const due = await this.questsWith.findMany({
        where: {
          reminderNextAt: { lte: now, isNotNull: true },
          reminderInterval: { isNotNull: true },
          acceptedBy: { isNotNull: true },
          acceptedAt: { isNotNull: true },
          completedAt: { isNull: true },
        },
        orderBy: [{ column: "reminderNextAt", direction: "asc" }],
        limit: REMINDER_BATCH,
        include: { acceptedByUser: true, campaign: true },
      });
      if (due.length === 0) return;

      // Absolute base for the email link. Empty when PUBLIC_URL is unset
      // (links degrade to relative). On Cloudflare it's auto-set from the
      // platform domain and lifted into `alepha.env` by the Worker entrypoint.
      const baseUrl = this.alepha.env.PUBLIC_URL ?? "";

      for (const quest of due) {
        try {
          if (!quest.acceptedBy || !quest.reminderInterval) continue;
          const recipient = quest.acceptedByUser;
          const campaign = quest.campaign;
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
              questUrl: `${baseUrl}/c/${campaign.id}/q/${quest.shortId}`,
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
