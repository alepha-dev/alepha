import { AlephaTable } from "@alepha/ui/components/alepha-table";
import { Badge } from "@alepha/ui/components/ui/badge";
import type { Page } from "alepha";
import type { AdminPaymentController } from "alepha/api/payments";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useCallback } from "react";

const formatAmount = (cents: number, currency = "USD") => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format((cents ?? 0) / 100);
};

export function AdminPayments() {
  const client = useClient<AdminPaymentController>();
  const { l } = useI18n();

  const fetcher = useCallback(
    async (params: { page: number; size: number; sort?: string }) => {
      const res = await client.listIntents({ query: params as never });
      return res as Page<any>;
    },
    [client],
  );

  return (
    <div className="p-6">
      <AlephaTable
        fetch={fetcher}
        header={
          <div>
            <h1 className="text-lg font-semibold">Payments</h1>
            <p className="text-muted-foreground text-sm">
              Payment intents, charges, and subscriptions.
            </p>
          </div>
        }
        columns={{
          createdAt: {
            label: "When",
            sortable: true,
            cell: (p) => (
              <span className="text-muted-foreground text-xs">
                {String(l(p.createdAt, { date: "fromNow" }))}
              </span>
            ),
          },
          amount: {
            label: "Amount",
            align: "right",
            cell: (p) => (
              <span className="font-medium tabular-nums">
                {formatAmount(p.amount, p.currency)}
              </span>
            ),
          },
          customer: {
            label: "Customer",
            cell: (p) => (
              <span className="text-sm">
                {p.customerEmail ?? p.customerId ?? "—"}
              </span>
            ),
          },
          provider: {
            label: "Provider",
            cell: (p) => <Badge variant="secondary">{p.provider ?? "—"}</Badge>,
          },
          status: {
            label: "Status",
            cell: (p) => {
              const s = p.status ?? "pending";
              const variant =
                s === "succeeded" || s === "paid"
                  ? "default"
                  : s === "failed"
                    ? "destructive"
                    : "outline";
              return <Badge variant={variant as never}>{s}</Badge>;
            },
          },
        }}
      />
    </div>
  );
}
