import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  TimeAgo,
} from "@alepha/ui";
import type { AdminGitHubController } from "@lore/core/api";
import { useClient, useQuery } from "alepha/react";

/**
 * Admin > GitHub's last deliveries (#Q4364): event, repository, outcome and
 * attempts, never the body. Read once when the page opens.
 */
const AdminGitHubDeliveries = () => {
  const client = useClient<AdminGitHubController>();
  const deliveries = useQuery(
    {
      key: ["admin-github-deliveries"],
      handler: () => client.listGitHubDeliveries(),
    },
    [client],
  );
  const items = deliveries.data?.items ?? [];

  return (
    <Card data-testid="admin-github-deliveries">
      <CardHeader>
        <CardTitle>Deliveries</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">None yet</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="py-1 font-normal">Event</th>
                <th className="py-1 font-normal">Repository</th>
                <th className="py-1 font-normal">Outcome</th>
                <th className="py-1 font-normal">Attempts</th>
                <th className="py-1 font-normal">Received</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t">
                  <td className="py-1">
                    {item.event}
                    {item.action ? `.${item.action}` : ""}
                  </td>
                  <td className="py-1">{item.repository ?? ""}</td>
                  <td className="py-1" title={item.lastError ?? undefined}>
                    <Badge
                      variant="tint"
                      tone={
                        item.status === "handled"
                          ? "success"
                          : item.status === "failed"
                            ? "danger"
                            : item.status === "pending" ||
                                item.status === "handling"
                              ? "warning"
                              : "neutral"
                      }
                    >
                      {item.status}
                    </Badge>
                  </td>
                  <td className="py-1">{item.attempts}</td>
                  <td className="py-1">
                    <TimeAgo value={item.receivedAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
};

export default AdminGitHubDeliveries;
