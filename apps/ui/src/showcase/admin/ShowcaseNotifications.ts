import type { Page } from "alepha";
import type {
  NotificationResource,
  NotificationTemplateResource,
} from "alepha/api/notifications";

/**
 * A fake delivery log and the templates that produced it.
 *
 * ⚠️ Every row's `template` is one the template list also declares. The filter
 * bar is built from the templates, so a row naming a template the list does not
 * carry is a row no filter can ever reach.
 */
export class ShowcaseNotifications {
  public templates(): NotificationTemplateResource[] {
    return [
      {
        name: "welcome",
        category: "onboarding",
        description: "Sent once, when an account is first verified.",
        channels: ["email"],
        critical: false,
        sensitive: false,
      },
      {
        name: "password-reset",
        category: "security",
        description: "Carries a one-time code, so its body is never stored.",
        channels: ["email"],
        critical: true,
        // A sensitive template renders no subject in the listing, which is
        // the one row worth having here: it is the only way to see that
        // behaviour without a real secret.
        sensitive: true,
      },
      {
        name: "weekly-digest",
        category: "lifecycle",
        description: "A summary of the week, opt-out.",
        channels: ["email"],
        critical: false,
        sensitive: false,
      },
      {
        name: "deploy-failed",
        category: "ops",
        description: "Alerts the on-call engineer.",
        channels: ["email", "sms"],
        critical: true,
        sensitive: false,
      },
    ];
  }

  public paginate(
    query: ShowcaseNotificationQuery,
  ): Page<NotificationResource> {
    const size = Number(query.size ?? 20);
    const number = Number(query.page ?? 0);

    let rows = this.rows();

    if (query.template) {
      rows = rows.filter((r) => r.template === query.template);
    }
    if (query.status) {
      rows = rows.filter((r) => r.status === query.status);
    }

    const offset = number * size;
    const content = rows.slice(offset, offset + size);
    const totalPages = Math.max(1, Math.ceil(rows.length / size));

    return {
      content,
      page: {
        number,
        size,
        offset,
        numberOfElements: content.length,
        totalElements: rows.length,
        totalPages,
        isEmpty: content.length === 0,
        isFirst: number === 0,
        isLast: number >= totalPages - 1,
      },
    };
  }

  /**
   * One row per status the listing renders differently, including a `skipped`
   * one (which is the only way to see `skipReason`) and one whose outbox row
   * has aged out, which is what disables Resend rather than offering an action
   * that can only fail.
   */
  public rows(): NotificationResource[] {
    const seed: [string, string, string, string | undefined][] = [
      ["welcome", "delivered", "ada@alepha.dev", undefined],
      ["password-reset", "delivered", "alan@alepha.dev", undefined],
      ["weekly-digest", "sent", "grace@alepha.dev", undefined],
      ["deploy-failed", "bounced", "oncall@alepha.dev", undefined],
      ["weekly-digest", "skipped", "edsger@alepha.dev", "unsubscribed"],
      ["welcome", "delivered", "barbara@alepha.dev", undefined],
      ["deploy-failed", "failed", "oncall@alepha.dev", undefined],
      ["weekly-digest", "sent", "radia@alepha.dev", undefined],
    ];

    return seed.map(([template, status, contact, skipReason], i) => {
      const sensitive = template === "password-reset";
      return {
        id: `00000000-0000-4000-d000-${String(i + 1).padStart(12, "0")}`,
        createdAt: this.at(i * 3 + 1),
        executionId: `exec_${String(i + 1).padStart(6, "0")}`,
        status,
        template,
        type: "email",
        contact,
        category: this.templates().find((t) => t.name === template)?.category,
        critical: template === "deploy-failed" || sensitive,
        skipReason,
        // A sensitive template stores no rendered subject, so the listing has
        // nothing to show for it. That is the real behaviour, not a gap.
        subject: sensitive ? undefined : this.subjectFor(template),
        provider: "smtp",
        messageId: `<${String(i + 1).padStart(6, "0")}@alepha.dev>`,
        smtpStatusCode: status === "bounced" ? "550" : "250",
        lastEventAt: this.at(i * 3),
        error:
          status === "failed"
            ? "The connection was refused by the relay."
            : undefined,
        // The two oldest rows have aged past the outbox retention window, so
        // Resend is disabled on them.
        outboxAvailable: i < seed.length - 2,
      };
    }) as NotificationResource[];
  }

  protected subjectFor(template: string): string {
    return (
      {
        welcome: "Welcome to Alepha",
        "weekly-digest": "Your week in review",
        "deploy-failed": "Deploy failed on main",
      }[template] ?? "Notification"
    );
  }

  protected at(hoursAgo: number): string {
    return new Date(
      Date.UTC(2026, 8, 5, 9, 0) - hoursAgo * 3_600_000,
    ).toISOString();
  }
}

export interface ShowcaseNotificationQuery {
  page?: number;
  size?: number;
  sort?: string;
  template?: string;
  status?: string;
}
