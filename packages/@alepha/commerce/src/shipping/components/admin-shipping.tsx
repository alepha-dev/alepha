import * as React from "react";

void React;

import { AdminPage } from "@alepha/ui/components/admin/admin-page";
import { useConfirmedAction } from "@alepha/ui/components/admin/use-confirmed-action";
import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@alepha/ui/components/ui/tabs";
import { z } from "alepha";
import { useClient, useQuery } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Ban, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdminShippingController } from "../controllers/AdminShippingController.ts";
import type { ShippingRateEntity } from "../entities/shippingRates.ts";

const formatPrice = (cents: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
    (cents ?? 0) / 100,
  );

/**
 * Delivery zones and their rates.
 *
 * Zones are tabs rather than a second table: a shop has two or three of them, and
 * a master/detail layout for three rows is more chrome than content. Selecting a
 * zone swaps the rate list beneath it.
 */
export function AdminShipping() {
  const client = useClient<AdminShippingController>();
  const { tr } = useI18n();

  const [zoneId, setZoneId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);

  const { data: zones, refetch: refetchZones } = useQuery(
    {
      key: ["commerce", "shipping-zones"],
      handler: () => client.commerceAdminShippingZones({}),
    },
    [client],
  );

  // Select the narrowest zone once they arrive, so the page is never empty while
  // a zone exists.
  useEffect(() => {
    if (!zoneId && zones?.zones.length) {
      setZoneId(zones.zones[0]!.id);
    }
  }, [zoneId, zones]);

  const fetcher = useCallback(
    async (params: { page: number; size: number }) => {
      if (!zoneId) {
        // No zone yet: an empty page rather than a request that cannot be made.
        return {
          content: [],
          page: {
            number: 0,
            size: params.size,
            offset: 0,
            numberOfElements: 0,
            isEmpty: true,
            isFirst: true,
            isLast: true,
          },
        };
      }
      return client.commerceAdminShippingRates({ params: { zoneId } });
    },
    [client, zoneId],
  );

  const deactivate = useConfirmedAction<[ShippingRateEntity, () => void]>(
    {
      confirm: (rate) => ({
        title: String(
          tr("commerce.admin.withdrawRate", { default: "Withdraw this rate" }),
        ),
        description: String(
          tr("commerce.admin.withdrawRateConfirm", {
            default: `“${rate.name}” is no longer offered at checkout. Past orders keep it, and you can put it back later.`,
            args: [rate.name],
          }),
        ),
        destructive: true,
      }),
      handler: async (rate, refresh) => {
        await client.commerceAdminShippingDeactivateRate({
          params: { id: rate.id },
        });
        refresh();
      },
    },
    [client],
  );

  return (
    <AdminPage>
      {zones?.zones.length ? (
        <Tabs value={zoneId} onValueChange={setZoneId} className="mb-4">
          <TabsList>
            {zones.zones.map((zone) => (
              <TabsTrigger key={zone.id} value={zone.id}>
                {zone.name}
                <span className="text-muted-foreground ml-2 text-xs">
                  {zone.countries.length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}

      <AlephaTable<ShippingRateEntity>
        className="min-h-0 flex-1"
        persistenceKey="commerce.admin.shipping"
        fetch={fetcher}
        refreshSignal={`${zoneId}:${refreshSignal}`}
        emptyMessage={String(
          tr("commerce.admin.noRates", {
            default: "No shipping rate in this zone.",
          }),
        )}
        toolbar={
          <Button
            size="sm"
            onClick={() => setCreating(true)}
            disabled={!zoneId}
          >
            <Plus className="size-4" />
            {tr("commerce.admin.newRate", { default: "New rate" })}
          </Button>
        }
        rowActions={(rate) =>
          rate.active
            ? [
                {
                  label: String(
                    tr("commerce.admin.withdraw", { default: "Withdraw" }),
                  ),
                  icon: Ban,
                  destructive: true,
                  onClick: (item, ctx) =>
                    void deactivate.run(item, ctx.refresh),
                },
              ]
            : []
        }
        columns={{
          name: {
            label: tr("commerce.admin.rateName", { default: "Rate" }),
            cell: (r) => (
              <div className="flex flex-col">
                <span className="font-medium">{r.name}</span>
                <span className="text-muted-foreground font-mono text-xs">
                  {r.code}
                </span>
              </div>
            ),
          },
          price: {
            label: tr("commerce.admin.ratePrice", { default: "Price" }),
            align: "right",
            cell: (r) => (
              <span className="tabular-nums">{formatPrice(r.price)}</span>
            ),
          },
          freeAbove: {
            label: tr("commerce.admin.freeAbove", { default: "Free above" }),
            align: "right",
            cell: (r) => (
              <span className="text-muted-foreground text-xs tabular-nums">
                {r.freeAbove != null ? formatPrice(r.freeAbove) : "—"}
              </span>
            ),
          },
          minDays: {
            label: tr("commerce.admin.delay", { default: "Lead time" }),
            cell: (r) => (
              <span className="text-muted-foreground text-xs">
                {r.minDays == null
                  ? "—"
                  : r.minDays === r.maxDays
                    ? `${r.minDays} j`
                    : `${r.minDays}–${r.maxDays} j`}
              </span>
            ),
          },
          active: {
            label: tr("commerce.admin.colStatus", { default: "Status" }),
            cell: (r) =>
              r.active ? (
                <Badge>
                  {tr("commerce.admin.offered", { default: "Offered" })}
                </Badge>
              ) : (
                <Badge variant="secondary">
                  {tr("commerce.admin.withdrawn", { default: "Withdrawn" })}
                </Badge>
              ),
          },
        }}
      />

      {creating && zoneId ? (
        <AdminRateSheet
          zoneId={zoneId}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            setRefreshSignal((n) => n + 1);
            void refetchZones();
          }}
        />
      ) : null}
    </AdminPage>
  );
}

interface AdminRateSheetProps {
  zoneId: string;
  onClose: () => void;
  onSaved: () => void;
}

const AdminRateSheet = (props: AdminRateSheetProps) => {
  const { zoneId, onClose, onSaved } = props;
  const client = useClient<AdminShippingController>();
  const { tr } = useI18n();

  const schema = useMemo(
    () =>
      z.object({
        name: z.text({ minLength: 1, maxLength: 100 }).meta({
          title: String(tr("commerce.admin.rateName", { default: "Rate" })),
          $control: { width: 60 },
        }),
        code: z.text({ minLength: 1, maxLength: 64 }).meta({
          title: String(tr("commerce.admin.rateCode", { default: "Code" })),
          description: String(
            tr("commerce.admin.rateCodeHint", {
              default: "Written on the order. Do not change it afterwards.",
            }),
          ),
          $control: { width: 40 },
        }),
        price: z
          .integer()
          .min(0)
          .meta({
            title: String(
              tr("commerce.admin.ratePriceCents", {
                default: "Price incl. tax (cents)",
              }),
            ),
            $control: { width: 50 },
          }),
        freeAbove: z
          .integer()
          .min(0)
          .meta({
            title: String(
              tr("commerce.admin.freeAboveCents", {
                default: "Free above (cents)",
              }),
            ),
            $control: { width: 50 },
          })
          .optional(),
        minDays: z
          .integer()
          .min(0)
          .max(365)
          .meta({
            title: String(
              tr("commerce.admin.minDays", {
                default: "Min. lead time (days)",
              }),
            ),
            $control: { width: 50 },
          })
          .optional(),
        maxDays: z
          .integer()
          .min(0)
          .max(365)
          .meta({
            title: String(
              tr("commerce.admin.maxDays", {
                default: "Max. lead time (days)",
              }),
            ),
            $control: { width: 50 },
          })
          .optional(),
      }),
    [tr],
  );

  const form = useForm({
    schema,
    initialValues: { price: 0 },
    handler: async (values) => {
      await client.commerceAdminShippingCreateRate({
        params: { zoneId },
        body: values,
      });
      onSaved();
    },
  });

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
            {tr("commerce.admin.newRate", { default: "New rate" })}
          </SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-6">
          <AutoForm
            form={form}
            submitLabel={String(tr("commerce.admin.save", { default: "Save" }))}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
};
