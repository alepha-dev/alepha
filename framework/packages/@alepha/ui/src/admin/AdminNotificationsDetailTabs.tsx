import { z } from "alepha";
import type { NotificationDetailResource } from "alepha/api/notifications";
import { useFieldValue, useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import { Control } from "../form/Control.tsx";
import { AdminNotificationsPreviewTab } from "./AdminNotificationsPreviewTab.tsx";
import { AdminNotificationsRawTab } from "./AdminNotificationsRawTab.tsx";
import { AdminNotificationsStatusBadge } from "./AdminNotificationsStatusBadge.tsx";

export interface AdminNotificationsDetailTabsProps {
  notificationId: string;
  detail: NotificationDetailResource;
  /**
   * The tab to open on. Read once, at mount.
   *
   * ⚠️ The parent gives this component a `key` derived from the row and the
   * requested tab, so arriving from a different row (or from the list's "Raw
   * data" action) remounts it and re-reads this. That is deliberately not an
   * effect: resetting state from `useEffect` is a cascading render, and the
   * lint rule that says so is right.
   */
  initialTab: string;
}

/**
 * The three views of one notification: what happened, what it looked like,
 * and everything else that was recorded.
 *
 * Switched by a `<Control segmented>` bound to a one-field form (#Q3428), the
 * kit's own segmented control, where it used to be `Tabs` restyled by hand.
 */
export const AdminNotificationsDetailTabs = (
  props: AdminNotificationsDetailTabsProps,
) => {
  const { l, tr } = useI18n();
  const form = useForm({
    schema: z.object({ tab: z.enum(["details", "preview", "raw"]) }),
    initialValues: {
      tab: (["details", "preview", "raw"].includes(props.initialTab)
        ? props.initialTab
        : "details") as "details" | "preview" | "raw",
    },
    handler: () => {},
  });
  const [tab] = useFieldValue(form.input.tab);
  const detail = props.detail;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Control
        input={form.input.tab}
        segmented
        // No label: the three choices name themselves, and a schema-derived
        // "Tab *" above them read as a form field to fill in.
        label=""
        inputProps={{
          "aria-label": tr("admin.notifications.tabs", { default: "View" }),
        }}
        items={[
          {
            value: "details",
            label: tr("admin.notifications.tabDetails", { default: "Details" }),
          },
          {
            value: "preview",
            label: tr("admin.notifications.tabPreview", { default: "Preview" }),
          },
          {
            value: "raw",
            label: tr("admin.notifications.tabRaw", { default: "Raw" }),
          },
        ]}
      />

      {tab === "details" ? (
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <AdminNotificationsStatusBadge status={detail.status} />
            {detail.skipReason ? (
              <span className="text-muted-foreground text-xs">
                {detail.skipReason}
              </span>
            ) : null}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <dt className="text-muted-foreground text-xs">
              {tr("admin.notifications.detailSent", { default: "Sent" })}
            </dt>
            <dd>{l(detail.createdAt, { date: "lll" })}</dd>

            {detail.lastEventAt ? (
              <>
                <dt className="text-muted-foreground text-xs">
                  {tr("admin.notifications.detailLastEvent", {
                    default: "Last event",
                  })}
                </dt>
                <dd>{l(detail.lastEventAt, { date: "lll" })}</dd>
              </>
            ) : null}

            <dt className="text-muted-foreground text-xs">
              {tr("admin.notifications.detailChannel", { default: "Channel" })}
            </dt>
            <dd>{detail.type ?? "-"}</dd>

            <dt className="text-muted-foreground text-xs">
              {tr("admin.notifications.detailCategory", {
                default: "Category",
              })}
            </dt>
            <dd>{detail.category ?? "-"}</dd>

            <dt className="text-muted-foreground text-xs">
              {tr("admin.notifications.detailProvider", {
                default: "Provider",
              })}
            </dt>
            <dd>{detail.provider ?? "-"}</dd>

            {detail.smtpStatusCode ? (
              <>
                <dt className="text-muted-foreground text-xs">
                  {tr("admin.notifications.detailSmtpCode", {
                    default: "SMTP code",
                  })}
                </dt>
                <dd>{detail.smtpStatusCode}</dd>
              </>
            ) : null}
          </dl>

          {detail.subject ? (
            <div>
              <div className="text-muted-foreground text-xs">
                {tr("admin.notifications.detailSubject", {
                  default: "Subject",
                })}
              </div>
              <div>{detail.subject}</div>
            </div>
          ) : null}

          {detail.error ? (
            <div>
              <div className="text-muted-foreground text-xs">
                {tr("admin.notifications.detailError", { default: "Error" })}
              </div>
              <pre className="bg-muted overflow-x-auto rounded p-2 text-xs">
                {detail.error}
              </pre>
            </div>
          ) : null}

          {detail.outboxAvailable === false ? (
            <p className="text-muted-foreground text-xs">
              {tr("admin.notifications.detailOutboxGone", {
                default:
                  "The original job record has passed its retention window, so variables and logs are no longer available. The receipt is kept for longer.",
              })}
            </p>
          ) : null}
        </div>
      ) : null}

      {tab === "preview" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {/* `active` gates the fetch, so opening a row never re-renders a
            template nobody asked to see. */}
          <AdminNotificationsPreviewTab
            notificationId={props.notificationId}
            active={tab === "preview"}
          />
        </div>
      ) : null}

      {tab === "raw" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <AdminNotificationsRawTab detail={detail} />
        </div>
      ) : null}
    </div>
  );
};
