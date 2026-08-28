import { Badge } from "@alepha/ui/components/ui/badge";

export interface AdminNotificationsStatusBadgeProps {
  status?: string;
}

/**
 * A delivery status, coloured by what it means to an operator.
 *
 * ⚠️ These are the **receipt** statuses, not the job's. The list used to
 * render `job_executions.status`, which never wrote `sent` or `delivered`,
 * so every badge fell through to the neutral outline and the column said
 * nothing.
 *
 * `skipped` is deliberately not destructive: the gate refusing to mail
 * someone who unsubscribed is the system working, not a failure.
 */
export const AdminNotificationsStatusBadge = (
  props: AdminNotificationsStatusBadgeProps,
) => {
  const status = props.status ?? "sent";

  const variant =
    status === "delivered"
      ? "default"
      : status === "bounced" ||
          status === "complained" ||
          status === "failed" ||
          status === "rejected"
        ? "destructive"
        : "outline";

  return <Badge variant={variant as never}>{status}</Badge>;
};
