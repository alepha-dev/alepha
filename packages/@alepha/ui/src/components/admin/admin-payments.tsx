import * as React from "react";

void React;

import { AdminPage } from "@alepha/ui/components/admin/admin-page";
import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Badge } from "@alepha/ui/components/ui/badge";
import type {
  AdminPaymentController,
  IntentResource,
} from "alepha/api/payments";
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
  const { l, tr } = useI18n();

  const fetcher = useCallback(
    async (params: { page: number; size: number; sort?: string }) => {
      return client.listIntents({ query: params });
    },
    [client],
  );

  return (
    <AdminPage>
      <AlephaTable<IntentResource>
        className="min-h-0 flex-1"
        persistenceKey="admin.payments"
        fetch={fetcher}
        columns={{
          createdAt: {
            label: tr("admin.payments.colWhen", { default: "When" }),
            sortable: true,
            cell: (p) => (
              <span className="text-muted-foreground text-xs">
                {String(l(p.createdAt, { date: "fromNow" }))}
              </span>
            ),
          },
          amount: {
            label: tr("admin.payments.colAmount", { default: "Amount" }),
            align: "right",
            cell: (p) => (
              <span className="font-medium tabular-nums">
                {formatAmount(p.amount, p.currency)}
              </span>
            ),
          },
          customer: {
            label: tr("admin.payments.colCustomer", { default: "Customer" }),
            cell: (p) => (
              <span className="text-muted-foreground font-mono text-xs">
                {p.userId?.slice(0, 8) ?? "—"}
              </span>
            ),
          },
          provider: {
            label: tr("admin.payments.colProvider", { default: "Provider" }),
            cell: (p) => (
              <code className="text-xs">{p.providerRef ?? "—"}</code>
            ),
          },
          status: {
            label: tr("admin.payments.colStatus", { default: "Status" }),
            cell: (p) => {
              const s = p.status;
              const variant =
                s === "captured" || s === "refunded"
                  ? "default"
                  : s === "failed" ||
                      s === "cancelled" ||
                      s === "expired" ||
                      s === "voided"
                    ? "destructive"
                    : "outline";
              return <Badge variant={variant}>{s}</Badge>;
            },
          },
        }}
      />
    </AdminPage>
  );
}

export default AdminPayments;
