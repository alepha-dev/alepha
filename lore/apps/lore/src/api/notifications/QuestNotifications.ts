import { $inject, z } from "alepha";
import { $notification } from "alepha/api/notifications";

import { formatReference } from "../../web/app/components/shared/element/typedReference.ts";
import { NotificationHtmlEscaper } from "./NotificationHtmlEscaper.ts";

/**
 * Email templates for the Quest module. Currently just the per-quest
 * reminder (see Lore quest #42). Frequency and trigger time live on the
 * quest row itself; this class only defines the rendering.
 */
export class QuestNotifications {
  protected readonly html = $inject(NotificationHtmlEscaper);

  public readonly questReminder = $notification({
    category: "tasks",
    description:
      "Periodic reminder email sent to the assignee of an accepted quest while it remains open. Configured per-quest by the assignee via the Quest Settings panel.",
    email: {
      subject: "Quest reminder",
      body: (it) => {
        const projectTitle = this.html.escape(it.projectTitle);
        const recipientName = this.html.escape(it.recipientName);
        const questTitle = this.html.escape(it.questTitle);
        const questUrl = encodeURI(it.questUrl);
        return `
        <h1>${projectTitle} — Quest reminder</h1>
        <p>Hi ${recipientName},</p>
        <p>You accepted the quest <strong>${questTitle}</strong> (${formatReference("quest", it.shortId)}) and haven't completed it yet. Just a nudge while it's still open.</p>
        <p>
          <a href="${questUrl}" style="display: inline-block; padding: 10px 20px; background-color: #4f46e5; color: white; text-decoration: none; border-radius: 6px;">
            Open quest
          </a>
        </p>
        <p>You can change the reminder cadence or turn it off from the quest's Settings panel.</p>
      `;
      },
    },
    schema: z.object({
      recipientName: z.string(),
      projectTitle: z.string(),
      questTitle: z.string(),
      shortId: z.integer(),
      questUrl: z.string(),
    }),
  });
}
