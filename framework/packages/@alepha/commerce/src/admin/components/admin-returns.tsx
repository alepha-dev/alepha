import * as React from "react";

void React;

import { Badge, useDialog } from "@alepha/ui";
import { AdminPage, useConfirmedAction } from "@alepha/ui/admin";
import {
  DataTable,
  type DataTableFilterFields,
  type DataTableFilterValues,
} from "@alepha/ui/table";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Ban, CircleDot, PackageOpen, Receipt } from "lucide-react";
import { useCallback } from "react";

import type { OrderReturnEntity } from "../../entities/orderReturns.ts";
import { orderReturnStatusSchema } from "../../schemas/orderReturnStatusSchema.ts";
import type { AdminReturnController } from "../controllers/AdminReturnController.ts";

const STATUS_VARIANT: Record<
  OrderReturnEntity["status"],
  "default" | "secondary" | "outline" | "destructive"
> = {
  requested: "default",
  received: "secondary",
  refunded: "outline",
  refused: "destructive",
};

/**
 * Returns: what is expected, what arrived, what is owed.
 *
 * Each step is its own click, because each is a fact only somebody at the bench
 * knows: the parcel came, and it can be refunded.
 */
export const AdminReturns = () => {
  const client = useClient<AdminReturnController>();
  const { l, tr } = useI18n();
  const dialog = useDialog();

  const statusLabel = (status: string) =>
    tr(`commerce.return.${status}`, { default: status });

  const filterFields = {
    status: {
      schema: orderReturnStatusSchema,
      mode: "default",
      label: tr("commerce.admin.colStatus", { default: "Status" }),
      icon: CircleDot,
      optionLabel: statusLabel,
      control: {
        clearLabel: tr("commerce.admin.allStatuses", {
          default: "All statuses",
        }),
      },
    },
  } satisfies DataTableFilterFields;

  const fetcher = useCallback(
    (params: {
      page: number;
      size: number;
      filters?: DataTableFilterValues<typeof filterFields>;
    }) =>
      client.commerceAdminReturnList({
        query: {
          page: params.page,
          size: params.size,
          ...(params.filters?.status ? { status: params.filters.status } : {}),
        },
      }),
    [client],
  );

  const receive = useConfirmedAction<[OrderReturnEntity, () => void]>(
    {
      confirm: () => ({
        title: tr("commerce.admin.returns.receiveTitle", {
          default: "Parcel received",
        }),
        description: tr("commerce.admin.returns.receiveConfirm", {
          default: "The units go back in stock.",
        }),
      }),
      handler: async (returned, refresh) => {
        await client.commerceAdminReturnReceive({
          params: { id: returned.id },
          body: {},
        });
        refresh();
      },
    },
    [client],
  );

  const refund = useConfirmedAction<[OrderReturnEntity, () => void]>(
    {
      confirm: () => ({
        title: tr("commerce.admin.returns.refundTitle", {
          default: "Refund this return",
        }),
        description: tr("commerce.admin.returns.refundConfirm", {
          default:
            "The money for these units goes back to the customer, and a credit note is issued. A return of the whole order refunds the delivery too.",
        }),
        destructive: true,
      }),
      handler: async (returned, refresh) => {
        await client.commerceAdminReturnRefund({
          params: { id: returned.id },
          body: {},
        });
        refresh();
      },
    },
    [client],
  );

  const refuse = useCallback(
    async (returned: OrderReturnEntity, refresh: () => void) => {
      const note = await dialog.prompt({
        title: tr("commerce.admin.returns.refuseTitle", {
          default: "Refuse this return",
        }),
        description: tr("commerce.admin.returns.refuseHint", {
          default: "Say why: the customer reads it.",
        }),
        confirmLabel: tr("commerce.admin.returns.refuse", {
          default: "Refuse",
        }),
      });
      if (note === undefined) {
        return;
      }
      await client.commerceAdminReturnRefuse({
        params: { id: returned.id },
        body: note ? { note } : {},
      });
      refresh();
    },
    [client, dialog, tr],
  );

  return (
    <AdminPage>
      <DataTable<OrderReturnEntity, typeof filterFields>
        className="min-h-0 flex-1"
        persistenceKey="commerce.admin.returns"
        fetch={fetcher}
        filters={{ fields: filterFields }}
        emptyMessage={tr("commerce.admin.returns.empty", {
          default: "No return.",
        })}
        rowActions={(returned) => [
          {
            label: tr("commerce.admin.returns.receive", {
              default: "Parcel received",
            }),
            icon: PackageOpen,
            disabled: () => returned.status !== "requested",
            onClick: (item, ctx) => void receive.run(item, ctx.refresh),
          },
          {
            label: tr("commerce.admin.refund", { default: "Refund" }),
            icon: Receipt,
            disabled: () => returned.status !== "received",
            onClick: (item, ctx) => void refund.run(item, ctx.refresh),
          },
          {
            label: tr("commerce.admin.returns.refuse", { default: "Refuse" }),
            icon: Ban,
            destructive: true,
            disabled: () =>
              returned.status === "refunded" || returned.status === "refused",
            onClick: (item, ctx) => void refuse(item, ctx.refresh),
          },
        ]}
        columns={{
          createdAt: {
            label: tr("commerce.admin.colWhen", { default: "Date" }),
            cell: (r) => (
              <span className="text-muted-foreground text-xs">
                {l(r.createdAt, { date: "lll" })}
              </span>
            ),
          },
          status: {
            label: tr("commerce.admin.colStatus", { default: "Status" }),
            cell: (r) => (
              <Badge variant={STATUS_VARIANT[r.status]}>
                {statusLabel(r.status)}
              </Badge>
            ),
          },
          lines: {
            label: tr("commerce.admin.returns.colUnits", { default: "Units" }),
            align: "right",
            cell: (r) => (
              <span className="tabular-nums">
                {r.lines.reduce((sum, line) => sum + line.quantity, 0)}
              </span>
            ),
          },
          reason: {
            label: tr("commerce.admin.returns.colReason", {
              default: "Reason",
            }),
            cell: (r) => (
              <span className="text-muted-foreground text-xs">
                {r.reason ?? ""}
              </span>
            ),
          },
        }}
      />
    </AdminPage>
  );
};
