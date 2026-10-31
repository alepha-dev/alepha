import * as React from "react";

void React;

import {
  Badge,
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui";
import { AdminPage, useConfirmedAction } from "@alepha/ui/admin";
import { AutoForm } from "@alepha/ui/form";
import { DataTable } from "@alepha/ui/table";
import { type Infer, z } from "alepha";
import { useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Ban, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import type { AdminPromotionController } from "../controllers/AdminPromotionController.ts";

/**
 * A row of the list, inferred from the client so the screen follows the route.
 */
type PromotionRow = Awaited<
  ReturnType<AdminPromotionController["commerceAdminPromotionList"]["run"]>
>["content"][number];

const formatPrice = (cents: number, currency = "EUR") =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(cents / 100);

/**
 * Discount codes and automatic discounts.
 *
 * A promotion that has been used stays: deleting is for a mistake, switching
 * off is for an offer that ended.
 */
export const AdminPromotions = () => {
  const client = useClient<AdminPromotionController>();
  const { tr } = useI18n();
  const [editing, setEditing] = useState<PromotionRow | "new">();
  const [refreshSignal, setRefreshSignal] = useState(0);

  const fetcher = useCallback(
    (params: { page: number; size: number }) =>
      client.commerceAdminPromotionList({
        query: { page: params.page, size: params.size },
      }),
    [client],
  );

  const switchOff = useConfirmedAction<[PromotionRow, () => void]>(
    {
      confirm: (promotion) => ({
        title: tr("commerce.admin.promotions.offTitle", {
          default: "Switch this promotion off",
        }),
        description: tr("commerce.admin.promotions.offConfirm", {
          default: `“${promotion.name}” stops applying. Orders that used it keep their discount.`,
          args: [promotion.name],
        }),
      }),
      handler: async (promotion, refresh) => {
        await client.commerceAdminPromotionUpdate({
          params: { id: promotion.id },
          body: { active: false },
        });
        refresh();
      },
    },
    [client],
  );

  const remove = useConfirmedAction<[PromotionRow, () => void]>(
    {
      confirm: (promotion) => ({
        title: tr("commerce.admin.promotions.deleteTitle", {
          default: "Delete this promotion",
        }),
        description: tr("commerce.admin.promotions.deleteConfirm", {
          default: `Permanently delete “${promotion.name}”?`,
          args: [promotion.name],
        }),
        destructive: true,
      }),
      handler: async (promotion, refresh) => {
        await client.commerceAdminPromotionDelete({
          params: { id: promotion.id },
        });
        refresh();
      },
    },
    [client],
  );

  const describeValue = (promotion: PromotionRow) => {
    if (promotion.kind === "percent") {
      return `${promotion.value / 100} %`;
    }
    if (promotion.kind === "amount") {
      return formatPrice(promotion.value, promotion.currency);
    }
    return tr("commerce.admin.promotions.freeShipping", {
      default: "Free delivery",
    });
  };

  return (
    <AdminPage>
      <DataTable<PromotionRow>
        className="min-h-0 flex-1"
        persistenceKey="commerce.admin.promotions"
        fetch={fetcher}
        refreshSignal={refreshSignal}
        emptyMessage={tr("commerce.admin.promotions.empty", {
          default: "No promotion yet.",
        })}
        toolbar={
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            {tr("commerce.admin.promotions.new", { default: "New promotion" })}
          </Button>
        }
        rowActions={(promotion) => [
          {
            label: tr("commerce.admin.edit", { default: "Edit" }),
            icon: Pencil,
            onClick: () => setEditing(promotion),
          },
          ...(promotion.active
            ? [
                {
                  label: tr("commerce.admin.promotions.off", {
                    default: "Switch off",
                  }),
                  icon: Ban,
                  onClick: (item: PromotionRow, ctx: { refresh: () => void }) =>
                    void switchOff.run(item, ctx.refresh),
                },
              ]
            : []),
          ...(promotion.used === 0
            ? [
                {
                  label: tr("commerce.admin.promotions.delete", {
                    default: "Delete",
                  }),
                  icon: Trash2,
                  destructive: true,
                  onClick: (item: PromotionRow, ctx: { refresh: () => void }) =>
                    void remove.run(item, ctx.refresh),
                },
              ]
            : []),
        ]}
        columns={{
          name: {
            label: tr("commerce.admin.promotions.colName", {
              default: "Promotion",
            }),
            cell: (promotion) => (
              <div className="flex flex-col">
                <span className="font-medium">{promotion.name}</span>
                <span className="text-muted-foreground font-mono text-xs">
                  {promotion.code ??
                    tr("commerce.admin.promotions.automatic", {
                      default: "Automatic",
                    })}
                </span>
              </div>
            ),
          },
          value: {
            label: tr("commerce.admin.promotions.colValue", {
              default: "Discount",
            }),
            align: "right",
            cell: (promotion) => (
              <span className="tabular-nums">{describeValue(promotion)}</span>
            ),
          },
          used: {
            label: tr("commerce.admin.promotions.colUsed", { default: "Used" }),
            align: "right",
            cell: (promotion) => (
              <span className="tabular-nums">
                {promotion.used}
                {promotion.usageLimit ? ` / ${promotion.usageLimit}` : ""}
              </span>
            ),
          },
          active: {
            label: tr("commerce.admin.colStatus", { default: "Status" }),
            cell: (promotion) =>
              promotion.active ? (
                <Badge>
                  {tr("commerce.admin.promotions.on", { default: "On" })}
                </Badge>
              ) : (
                <Badge variant="secondary">
                  {tr("commerce.admin.promotions.offBadge", { default: "Off" })}
                </Badge>
              ),
          },
        }}
      />

      {editing ? (
        <AdminPromotionSheet
          key={editing === "new" ? "new" : editing.id}
          promotion={editing === "new" ? undefined : editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            setRefreshSignal((n) => n + 1);
          }}
        />
      ) : null}
    </AdminPage>
  );
};

interface AdminPromotionSheetProps {
  promotion?: PromotionRow;
  onClose: () => void;
  onSaved: () => void;
}

const AdminPromotionSheet = (props: AdminPromotionSheetProps) => {
  const { promotion, onClose, onSaved } = props;
  const client = useClient<AdminPromotionController>();
  const { tr } = useI18n();

  const schema = useMemo(
    () =>
      z.object({
        name: z.text({ minLength: 1, maxLength: 120 }).meta({
          title: tr("commerce.admin.promotions.fName", { default: "Name" }),
          description: tr("commerce.admin.promotions.fNameHint", {
            default: "What the buyer reads on the cart.",
          }),
          $control: { width: 60 },
        }),
        code: z
          .text({ maxLength: 64 })
          .meta({
            title: tr("commerce.admin.promotions.fCode", { default: "Code" }),
            description: tr("commerce.admin.promotions.fCodeHint", {
              default:
                "Empty: applies on its own to every cart that qualifies.",
            }),
            $control: { width: 40 },
          })
          .optional(),
        kind: z.enum(["percent", "amount", "freeShipping"]).meta({
          title: tr("commerce.admin.promotions.fKind", { default: "Type" }),
          $control: {
            width: 50,
            items: [
              {
                value: "percent",
                label: tr("commerce.admin.promotions.kindPercent", {
                  default: "Percentage",
                }),
              },
              {
                value: "amount",
                label: tr("commerce.admin.promotions.kindAmount", {
                  default: "Fixed amount",
                }),
              },
              {
                value: "freeShipping",
                label: tr("commerce.admin.promotions.freeShipping", {
                  default: "Free delivery",
                }),
              },
            ],
          },
        }),
        value: z
          .integer()
          .min(0)
          .meta({
            title: tr("commerce.admin.promotions.fValue", {
              default: "Value",
            }),
            description: tr("commerce.admin.promotions.fValueHint", {
              default:
                "Basis points for a percentage (1000 = 10 %), cents for an amount.",
            }),
            $control: { width: 50 },
          })
          .optional(),
        minSubtotal: z
          .integer()
          .min(0)
          .meta({
            title: tr("commerce.admin.promotions.fMinSubtotal", {
              default: "Minimum order (cents)",
            }),
            $control: { width: 50 },
          })
          .optional(),
        currency: z
          .text({ minLength: 3, maxLength: 3 })
          .meta({
            title: tr("commerce.admin.promotions.fCurrency", {
              default: "Currency",
            }),
            description: tr("commerce.admin.promotions.fCurrencyHint", {
              default:
                "What the amounts are in, the shop's own when empty. A plain percentage applies in any currency.",
            }),
            $control: { width: 50 },
          })
          .optional(),
        usageLimit: z
          .integer()
          .min(1)
          .meta({
            title: tr("commerce.admin.promotions.fUsageLimit", {
              default: "Uses in total",
            }),
            $control: { width: 50 },
          })
          .optional(),
        usagePerCustomer: z
          .integer()
          .min(1)
          .meta({
            title: tr("commerce.admin.promotions.fUsagePerCustomer", {
              default: "Uses per customer",
            }),
            $control: { width: 50 },
          })
          .optional(),
        startsAt: z
          .text()
          .meta({
            title: tr("commerce.admin.promotions.fStartsAt", {
              default: "From (ISO date)",
            }),
            $control: { width: 50 },
          })
          .optional(),
        endsAt: z
          .text()
          .meta({
            title: tr("commerce.admin.promotions.fEndsAt", {
              default: "Until (ISO date)",
            }),
            $control: { width: 50 },
          })
          .optional(),
        active: z.boolean().meta({
          title: tr("commerce.admin.promotions.fActive", { default: "On" }),
        }),
      }),
    [tr],
  );

  const form = useForm(
    {
      schema,
      initialValues: {
        name: promotion?.name ?? "",
        code: promotion?.code,
        kind: promotion?.kind ?? "percent",
        value: promotion?.value,
        minSubtotal: promotion?.minSubtotal,
        currency: promotion?.currency,
        usageLimit: promotion?.usageLimit,
        usagePerCustomer: promotion?.usagePerCustomer,
        startsAt: promotion?.startsAt,
        endsAt: promotion?.endsAt,
        active: promotion?.active ?? true,
      } as Infer<typeof schema>,
      handler: async (values) => {
        if (promotion) {
          await client.commerceAdminPromotionUpdate({
            params: { id: promotion.id },
            body: values,
          });
        } else {
          await client.commerceAdminPromotionCreate({ body: values });
        }
        onSaved();
      },
    },
    [schema, promotion?.id],
  );

  return (
    <Sheet
      open
      onOpenChange={(open: boolean) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {promotion?.name ??
              tr("commerce.admin.promotions.new", {
                default: "New promotion",
              })}
          </SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-6">
          <AutoForm
            form={form}
            submitLabel={tr("commerce.admin.save", { default: "Save" })}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
};
