import { NotificationHtmlEscaper } from "@lore/core/api";
import { $inject } from "alepha";
import { $notification } from "alepha/api/notifications";

import { uptimeNotificationVariablesSchema } from "../schemas/uptimeNotificationVariablesSchema.ts";

export class UptimeNotifications {
  protected readonly html = $inject(NotificationHtmlEscaper);
  public readonly outage = $notification({
    category: "uptime",
    description: "A confirmed monitor outage has started.",
    schema: uptimeNotificationVariablesSchema,
    email: {
      subject: (it) => `Uptime outage: ${it.monitorName}`,
      body: (it) => `<h1>${this.html.escape(it.monitorName)} is down</h1>
        <p>Target: ${this.html.escape(it.target)}</p>
        <p>Failure: ${this.html.escape(it.cause)}. ${this.html.escape(it.error)}</p>
        <p>Incident started: ${this.html.escape(it.startedAt)}</p>
        <p><a href="${this.html.escape(it.detailsUrl)}">Open monitor</a></p>`,
    },
  });
  public readonly recovery = $notification({
    category: "uptime",
    description: "A monitor recovered from a confirmed outage.",
    schema: uptimeNotificationVariablesSchema,
    email: {
      subject: (it) => `Uptime recovery: ${it.monitorName}`,
      body: (it) => `<h1>${this.html.escape(it.monitorName)} recovered</h1>
        <p>Target: ${this.html.escape(it.target)}</p>
        <p>Recovered at ${this.html.escape(it.endedAt ?? "")}, after ${it.durationSecs} seconds.</p>
        <p>Incident started: ${this.html.escape(it.startedAt)}</p>
        <p>Previous failure: ${this.html.escape(it.cause)}. ${this.html.escape(it.error)}</p>
        <p><a href="${this.html.escape(it.detailsUrl)}">Open monitor</a></p>`,
    },
  });
}
