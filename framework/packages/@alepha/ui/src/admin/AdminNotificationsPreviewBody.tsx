import type { NotificationPreviewResource } from "alepha/api/notifications";
import { useI18n } from "alepha/react/i18n";

import { Badge } from "../core/Badge.tsx";
import { EmailBodyFrame } from "./EmailBodyFrame.tsx";

export interface AdminNotificationsPreviewBodyProps {
  preview: NotificationPreviewResource;
}

/**
 * What a preview looks like, given one already fetched.
 *
 * Split from the tab that fetches it so the interesting half - three
 * unavailable states that must not read alike - can be rendered in a test
 * without a container or a client.
 */
export const AdminNotificationsPreviewBody = (
  props: AdminNotificationsPreviewBodyProps,
) => {
  const { tr } = useI18n();
  const preview = props.preview;

  if (!preview.available) {
    /**
     * Three separate sentences, deliberately. All three are normal, and an
     * operator has to be able to tell retention (nothing to do) from a
     * sensitive template (nothing will ever be shown) from a deleted
     * template (someone changed the code). One shared "unavailable" would
     * make all three look like a bug.
     */
    const reasons: Record<string, string> = {
      "outbox-purged": tr("admin.notifications.previewPurged", {
        default:
          "The job record holding this message's variables has passed its retention window, so it can no longer be rendered. The receipt is kept for longer.",
      }),
      sensitive: tr("admin.notifications.previewSensitive", {
        default:
          "This template is marked sensitive, so its rendered content is never shown in the admin.",
      }),
      "template-missing": tr("admin.notifications.previewTemplateMissing", {
        default:
          "The template that produced this message is no longer registered in the app, so there is nothing left to render it with.",
      }),
    };

    return (
      <div>
        <p className="text-muted-foreground text-sm">
          {reasons[preview.reason ?? ""] ??
            tr("admin.notifications.previewUnavailable", {
              default: "This message cannot be previewed.",
            })}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-xs">
        {tr("admin.notifications.previewLive", {
          default:
            "Re-rendered from the template as it exists now. If the template changed since the send, this differs from what was delivered.",
        })}
      </p>

      {preview.subject ? (
        <div>
          <div className="text-muted-foreground text-xs">
            {tr("admin.notifications.detailSubject", { default: "Subject" })}
          </div>
          <div className="text-sm">{preview.subject}</div>
        </div>
      ) : null}

      {preview.attachments.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {tr("admin.notifications.previewAttachments", {
              default: "Attachments",
            })}
          </span>
          {/* Names only. The bytes are never resolved for a preview, so a
              purged file cannot break the render. */}
          {preview.attachments.map((attachment) => (
            <Badge key={attachment} variant="secondary">
              {attachment}
            </Badge>
          ))}
        </div>
      ) : null}

      {/* One flat body, and one question about it: is it HTML? Email is the
          only channel whose body is a document, so it is the only one that
          gets the sandboxed frame. Everything else - sms today, a chat sink
          tomorrow - is text and renders as text, with no per-channel branch
          to add. */}
      {preview.channel === "email" ? (
        // A definite height, not `flex-1`: inside the dialog's scrolling body
        // a flex child has no height to fill, and the frame collapsed to a
        // strip (#Q3428). The frame scrolls the message itself; it is white
        // in either scheme because that is what a mail client shows.
        <div
          className="h-[60vh] overflow-hidden rounded-lg border"
          data-testid="notification-preview-frame"
        >
          <EmailBodyFrame html={preview.body ?? ""} />
        </div>
      ) : (
        <div className="bg-muted rounded p-3 text-sm whitespace-pre-wrap">
          {preview.body}
        </div>
      )}
    </div>
  );
};
