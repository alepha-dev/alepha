import { AdminNotificationsPreviewTab } from "@alepha/ui/components/admin/admin-notifications-preview-tab";
import { AdminNotificationsRawTab } from "@alepha/ui/components/admin/admin-notifications-raw-tab";
import { AdminNotificationsStatusBadge } from "@alepha/ui/components/admin/admin-notifications-status-badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@alepha/ui/components/ui/tabs";
import type { NotificationDetailResource } from "alepha/api/notifications";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

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
 */
export const AdminNotificationsDetailTabs = (
  props: AdminNotificationsDetailTabsProps,
) => {
  const { l, tr } = useI18n();
  const [tab, setTab] = useState(props.initialTab);
  const detail = props.detail;

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(String(value))}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <TabsList className="mx-4">
        <TabsTrigger value="details">
          {tr("admin.notifications.tabDetails", { default: "Details" })}
        </TabsTrigger>
        <TabsTrigger value="preview">
          {tr("admin.notifications.tabPreview", { default: "Preview" })}
        </TabsTrigger>
        <TabsTrigger value="raw">
          {tr("admin.notifications.tabRaw", { default: "Raw" })}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="details" className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-6 px-4 pb-6 text-sm">
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
            <dd>{String(l(detail.createdAt, { date: "lll" }))}</dd>

            {detail.lastEventAt ? (
              <>
                <dt className="text-muted-foreground text-xs">
                  {tr("admin.notifications.detailLastEvent", {
                    default: "Last event",
                  })}
                </dt>
                <dd>{String(l(detail.lastEventAt, { date: "lll" }))}</dd>
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
      </TabsContent>

      <TabsContent
        value="preview"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        {/* `active` gates the fetch, so opening a row never re-renders a
            template nobody asked to see. */}
        <AdminNotificationsPreviewTab
          notificationId={props.notificationId}
          active={tab === "preview"}
        />
      </TabsContent>

      <TabsContent value="raw" className="min-h-0 flex-1 overflow-y-auto">
        <AdminNotificationsRawTab detail={detail} />
      </TabsContent>
    </Tabs>
  );
};
