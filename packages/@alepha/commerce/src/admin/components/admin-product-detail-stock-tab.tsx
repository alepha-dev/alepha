import * as React from "react";

void React;

import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { Badge } from "@alepha/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import type { FormModel } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import type { StockMovementEntity } from "../../entities/stockMovements.ts";
import type { AdminProductResource } from "../controllers/AdminProductController.ts";
import type { stockAdjustSchema } from "./stock-adjust-schema.ts";

export interface AdminProductDetailStockTabProps {
  product: AdminProductResource;
  form: FormModel<ReturnType<typeof stockAdjustSchema>>;
  fetch: React.ComponentProps<typeof AlephaTable<StockMovementEntity>>["fetch"];
  refreshSignal: number;
}

/**
 * Stock: the three figures, a way to correct them, and the ledger that explains
 * how they got there.
 *
 * The ledger is the point. On-hand is a *sum over this table* — never a counter
 * — so "why is this 3?" has an exact answer, and until now nothing in the back
 * office ever displayed it.
 */
export const AdminProductDetailStockTab = (
  props: AdminProductDetailStockTabProps,
) => {
  const { tr, l } = useI18n();
  const product = props.product;

  const figures: Array<{ label: string; value: number; alert?: boolean }> = [
    {
      label: String(
        tr("commerce.admin.availableLabel", { default: "Available" }),
      ),
      value: product.available,
      alert: product.available <= 0,
    },
    {
      label: String(tr("commerce.admin.onHandLabel", { default: "On hand" })),
      value: product.onHand,
    },
    {
      label: String(
        tr("commerce.admin.reservedLabel", { default: "Reserved" }),
      ),
      value: product.reserved,
    },
  ];

  const reasonLabel = (reason: string) =>
    ({
      intake: tr("commerce.admin.stock.reasonIntake", { default: "Intake" }),
      sale: tr("commerce.admin.stock.reasonSale", { default: "Sale" }),
      return: tr("commerce.admin.stock.reasonReturn", { default: "Return" }),
      adjustment: tr("commerce.admin.stock.reasonAdjustment", {
        default: "Adjustment",
      }),
    })[reason] ?? reason;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-6">
      <div className="grid grid-cols-3 gap-4">
        {figures.map((figure) => (
          <Card key={figure.label}>
            <CardContent className="flex flex-col gap-1">
              <span className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
                {figure.label}
              </span>
              <span
                className={
                  figure.alert
                    ? "text-destructive text-2xl font-semibold tabular-nums"
                    : "text-2xl font-semibold tabular-nums"
                }
              >
                {figure.value}
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {tr("commerce.admin.stock.adjustTitle", {
              default: "Correct the count",
            })}
          </CardTitle>
          <CardDescription>
            {tr("commerce.admin.stock.adjustHint", {
              default:
                "Records a movement in the ledger below. Use a negative quantity with 'Adjustment' to write stock off.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AutoForm
            form={props.form}
            submitLabel={String(
              tr("commerce.admin.stock.adjustCta", { default: "Record" }),
            )}
          />
        </CardContent>
      </Card>

      <Card className="flex min-h-96 flex-col">
        <CardHeader>
          <CardTitle>
            {tr("commerce.admin.stock.ledgerTitle", {
              default: "Movement history",
            })}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col">
          <AlephaTable<StockMovementEntity>
            className="min-h-0 flex-1"
            persistenceKey={`commerce.admin.product.${product.id}.movements`}
            fetch={props.fetch}
            refreshSignal={props.refreshSignal}
            emptyMessage={String(
              tr("commerce.admin.stock.ledgerEmpty", {
                default: "No stock movement recorded yet.",
              }),
            )}
            columns={{
              createdAt: {
                label: tr("commerce.admin.stock.colWhen", { default: "When" }),
                cell: (m) => (
                  <span className="text-muted-foreground text-xs">
                    {String(l(m.createdAt, { date: "lll" }))}
                  </span>
                ),
              },
              delta: {
                label: tr("commerce.admin.stock.colDelta", {
                  default: "Change",
                }),
                align: "right",
                cell: (m) => (
                  <span
                    className={
                      m.delta < 0
                        ? "text-destructive font-medium tabular-nums"
                        : "font-medium tabular-nums"
                    }
                  >
                    {m.delta > 0 ? `+${m.delta}` : m.delta}
                  </span>
                ),
              },
              reason: {
                label: tr("commerce.admin.stock.colReason", {
                  default: "Reason",
                }),
                cell: (m) => (
                  <Badge variant="outline">{reasonLabel(m.reason)}</Badge>
                ),
              },
              note: {
                label: tr("commerce.admin.stock.colNote", { default: "Note" }),
                cell: (m) => (
                  <span className="text-muted-foreground text-xs">
                    {m.note ?? (m.orderId ? `#${m.orderId.slice(0, 8)}` : "")}
                  </span>
                ),
              },
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
};
