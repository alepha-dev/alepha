import type { NotificationDetailResource } from "alepha/api/notifications";
import { useI18n } from "alepha/react/i18n";

export interface AdminNotificationsRawTabProps {
  detail: NotificationDetailResource;
}

/**
 * Everything the endpoint returns that the summary does not show.
 *
 * ⚠️ **Renders with most of it missing, on purpose.** `variables` and `logs`
 * come from the outbox row, which lives 7 days against the receipt's 90, so
 * they are simply absent on anything older. A `sensitive` template withholds
 * `variables` at the backend for good. Neither is an error state and neither
 * must look like one.
 *
 * This tab exists because all three fields were already being fetched by
 * `getNotification` and none of them was rendered anywhere.
 */
export const AdminNotificationsRawTab = (
  props: AdminNotificationsRawTabProps,
) => {
  const { tr } = useI18n();
  const detail = props.detail;

  const blocks: Array<{ label: string; value: unknown }> = [
    {
      label: tr("admin.notifications.detailVariables", {
        default: "Variables",
      }),
      value: detail.variables,
    },
    {
      label: tr("admin.notifications.rawRendered", { default: "Rendered" }),
      value:
        detail.rendered && Object.keys(detail.rendered).length > 0
          ? detail.rendered
          : undefined,
    },
    {
      label: tr("admin.notifications.rawLogs", { default: "Logs" }),
      value: detail.logs?.length ? detail.logs : undefined,
    },
  ];

  const present = blocks.filter((block) => block.value !== undefined);

  return (
    <div className="space-y-6 px-4 pb-6 text-sm">
      {present.map((block) => (
        <div key={block.label}>
          <div className="text-muted-foreground text-xs">{block.label}</div>
          <pre className="bg-muted overflow-x-auto rounded p-2 text-xs">
            {JSON.stringify(block.value, null, 2)}
          </pre>
        </div>
      ))}

      {detail.outboxAvailable === false ? (
        <p className="text-muted-foreground text-xs">
          {tr("admin.notifications.detailOutboxGone", {
            default:
              "The original job record has passed its retention window, so variables and logs are no longer available. The receipt is kept for longer.",
          })}
        </p>
      ) : present.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          {tr("admin.notifications.rawEmpty", {
            default:
              "Nothing more was recorded for this notification. A template marked sensitive withholds its variables from the admin.",
          })}
        </p>
      ) : null}
    </div>
  );
};
