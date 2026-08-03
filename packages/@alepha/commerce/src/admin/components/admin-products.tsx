import * as React from "react";

void React;

import { AdminPage } from "@alepha/ui/components/admin/admin-page";
import { useConfirmedAction } from "@alepha/ui/components/admin/use-confirmed-action";
import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui/components/ui/sheet";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { useClient, useQuery } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Eye, EyeOff, PackagePlus, Pencil, Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type {
  AdminProductController,
  AdminProductResource,
} from "../controllers/AdminProductController.ts";

const formatPrice = (cents: number, currency: string) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(
    (cents ?? 0) / 100,
  );

/**
 * Toolbar filter. Module scope so its identity stays stable across renders —
 * `AlephaTable` owns a `useForm` over it, and a fresh reference each render would
 * re-anchor that form for nothing.
 */
const filtersSchema = z.object({
  kind: z.string().optional(),
});

/**
 * Catalogue management: list, create, edit, publish, restock.
 *
 * Shows **available** stock rather than on-hand, with held units called out
 * separately: "3 in stock" is misleading when two are already in someone else's
 * checkout, and restocking decisions are made from what is sellable.
 *
 * The editor is a `Sheet`, not a route, so an operator correcting six prices
 * never leaves the list. `AutoForm` builds it from a zod schema, so a new product
 * field is one schema entry rather than a form redesign.
 */
export function AdminProducts() {
  const client = useClient<AdminProductController>();
  const { l, tr } = useI18n();
  const toast = useToast();

  const [editing, setEditing] = useState<AdminProductResource | "new">();
  const [refreshSignal, setRefreshSignal] = useState(0);

  // The kinds this deployment registered, read from the server rather than
  // hard-coded — which is what lets an application's own kind appear in the
  // picker without touching this component.
  const { data: kinds } = useQuery(
    {
      key: ["commerce", "product-kinds"],
      staleTime: [10, "minutes"],
      handler: () => client.commerceAdminProductKinds({}),
    },
    [client],
  );

  const fetcher = useCallback(
    async (params: {
      page: number;
      size: number;
      sort?: string;
      filters?: Record<string, any>;
    }) =>
      client.commerceAdminProductList({
        query: {
          page: params.page,
          size: params.size,
          // Omitted rather than passed as undefined: the query schema rejects it.
          ...(params.sort ? { sort: params.sort } : {}),
          ...(params.filters?.kind ? { kind: params.filters.kind } : {}),
        },
      }),
    [client],
  );

  const publish = useConfirmedAction<[AdminProductResource, () => void]>(
    {
      confirm: (product) => ({
        title: String(
          product.published
            ? tr("commerce.admin.unpublishTitle", {
                default: "Retirer de la vente",
              })
            : tr("commerce.admin.publishTitle", { default: "Mettre en vente" }),
        ),
        description: String(
          product.published
            ? tr("commerce.admin.unpublishConfirm", {
                default: `« ${product.name} » disparaîtra de la boutique. Les commandes déjà passées ne changent pas.`,
                args: [product.name],
              })
            : tr("commerce.admin.publishConfirm", {
                default: `« ${product.name} » sera visible et achetable.`,
                args: [product.name],
              }),
        ),
        destructive: product.published,
      }),
      handler: async (product, refresh) => {
        await client.commerceAdminProductPublish({
          params: { id: product.id },
          body: { published: !product.published },
        });
        refresh();
      },
    },
    [client],
  );

  const restock = useConfirmedAction<[AdminProductResource, () => void]>(
    {
      confirm: (product) => ({
        title: String(
          tr("commerce.admin.restockTitle", { default: "Réapprovisionner" }),
        ),
        description: String(
          tr("commerce.admin.restockConfirm", {
            default: `Ajouter une unité de « ${product.name} » au stock ?`,
            args: [product.name],
          }),
        ),
      }),
      // Deliberately +1 rather than a quantity prompt: a dialog that asks for a
      // number is a form, and forms belong in the editor. One click covers the
      // common case — a piece came back from the bench.
      handler: async (product, refresh) => {
        await client.commerceAdminProductRestock({
          params: { id: product.id },
          body: { quantity: 1 },
        });
        refresh();
      },
      success: (product) =>
        String(
          tr("commerce.admin.restocked", {
            default: `« ${product.name} » : +1 en stock.`,
            args: [product.name],
          }),
        ),
    },
    [client],
  );

  return (
    <AdminPage>
      <AlephaTable<AdminProductResource>
        className="min-h-0 flex-1"
        persistenceKey="commerce.admin.products"
        fetch={fetcher}
        refreshSignal={refreshSignal}
        onRowClick={(product) => setEditing(product)}
        emptyMessage={String(
          tr("commerce.admin.noProducts", {
            default: "Aucune pièce au catalogue.",
          }),
        )}
        filters={{
          schema: filtersSchema,
          render: (form) => (
            <div className="w-52">
              <Control
                input={form.input.kind}
                label={String(
                  tr("commerce.admin.colKind", { default: "Type" }),
                )}
                items={[
                  {
                    value: "",
                    label: String(
                      tr("commerce.admin.allKinds", {
                        default: "Tous les types",
                      }),
                    ),
                  },
                  ...(kinds?.kinds ?? []).map((kind) => ({
                    value: kind,
                    label: kind,
                  })),
                ]}
              />
            </div>
          ),
        }}
        toolbar={
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            {tr("commerce.admin.newProduct", { default: "Nouvelle pièce" })}
          </Button>
        }
        rowActions={(product) => [
          {
            label: String(tr("commerce.admin.edit", { default: "Modifier" })),
            icon: Pencil,
            onClick: (item) => setEditing(item),
          },
          {
            label: String(
              product.published
                ? tr("commerce.admin.unpublish", {
                    default: "Retirer de la vente",
                  })
                : tr("commerce.admin.publish", { default: "Mettre en vente" }),
            ),
            icon: product.published ? EyeOff : Eye,
            destructive: product.published,
            onClick: (item, ctx) => void publish.run(item, ctx.refresh),
          },
          {
            label: String(
              tr("commerce.admin.restock", { default: "Réapprovisionner" }),
            ),
            icon: PackagePlus,
            onClick: (item, ctx) => void restock.run(item, ctx.refresh),
          },
        ]}
        columns={{
          name: {
            label: tr("commerce.admin.colName", { default: "Produit" }),
            sortable: true,
            cell: (p) => (
              <div className="flex flex-col">
                <span className="font-medium">{p.name}</span>
                <span className="text-muted-foreground text-xs">{p.slug}</span>
              </div>
            ),
          },
          kind: {
            label: tr("commerce.admin.colKind", { default: "Type" }),
            cell: (p) => (
              <Badge variant="outline" className="font-mono text-xs">
                {p.kind}
              </Badge>
            ),
          },
          price: {
            label: tr("commerce.admin.colPrice", { default: "Prix" }),
            align: "right",
            sortable: true,
            cell: (p) => (
              <span className="font-medium tabular-nums">
                {formatPrice(p.price, p.currency)}
              </span>
            ),
          },
          available: {
            label: tr("commerce.admin.colStock", { default: "Stock" }),
            align: "right",
            cell: (p) => (
              <span className="tabular-nums">
                <span
                  className={
                    p.available <= 0
                      ? "text-destructive font-medium"
                      : "font-medium"
                  }
                >
                  {p.available}
                </span>
                {p.reserved > 0 ? (
                  <span className="text-muted-foreground text-xs">
                    {" "}
                    (+{p.reserved}{" "}
                    {tr("commerce.admin.reserved", { default: "réservés" })})
                  </span>
                ) : null}
              </span>
            ),
          },
          published: {
            label: tr("commerce.admin.colStatus", { default: "Statut" }),
            cell: (p) =>
              p.published ? (
                <Badge>
                  {tr("commerce.admin.online", { default: "En ligne" })}
                </Badge>
              ) : (
                <Badge variant="secondary">
                  {tr("commerce.admin.draft", { default: "Brouillon" })}
                </Badge>
              ),
          },
          createdAt: {
            label: tr("commerce.admin.colCreated", { default: "Ajouté" }),
            sortable: true,
            cell: (p) => (
              <span className="text-muted-foreground text-xs">
                {String(l(p.createdAt, { date: "lll" }))}
              </span>
            ),
          },
        }}
      />

      {/*
        Keyed on the row so opening a different product remounts the form with
        that row's values — `useForm` anchors its initial values once, so reusing
        the instance would show the previous product's data.
      */}
      {editing ? (
        <AdminProductSheet
          key={editing === "new" ? "new" : editing.id}
          product={editing}
          kinds={kinds?.kinds ?? []}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            setRefreshSignal((n) => n + 1);
            toast.success(
              String(
                tr("commerce.admin.saved", { default: "Pièce enregistrée." }),
              ),
            );
          }}
        />
      ) : null}
    </AdminPage>
  );
}

interface AdminProductSheetProps {
  product: AdminProductResource | "new";
  kinds: string[];
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Create or edit a piece.
 *
 * The schema is built per instance because both its labels and its kind list come
 * from runtime data. `AutoForm` renders it, so layout is a `width` per field
 * rather than a hand-built grid.
 */
const AdminProductSheet = (props: AdminProductSheetProps) => {
  const { product, kinds, onClose, onSaved } = props;
  const client = useClient<AdminProductController>();
  const { tr } = useI18n();

  const isNew = product === "new";
  const current = isNew ? undefined : product;

  const schema = useMemo(
    () =>
      z.object({
        name: z.text({ minLength: 1, maxLength: 200 }).meta({
          title: String(tr("commerce.admin.fName", { default: "Nom" })),
          $control: { width: 60 },
        }),
        slug: z.text({ minLength: 1, maxLength: 200 }).meta({
          title: String(tr("commerce.admin.fSlug", { default: "Référence" })),
          description: String(
            tr("commerce.admin.fSlugHint", {
              default:
                "Apparaît dans l'URL. Ne le changez plus après la mise en vente.",
            }),
          ),
          $control: { width: 40 },
        }),
        kind: z.text({ maxLength: 64 }).meta({
          title: String(tr("commerce.admin.fKind", { default: "Type" })),
          $control: {
            width: 50,
            items: kinds.map((kind) => ({ value: kind, label: kind })),
          },
        }),
        /*
         * Cents, and labelled as cents. An operator who types 8900 and sees
         * 89,00 € in the list learns the unit once; a euro field needs a
         * conversion on both sides and is where rounding bugs come from.
         */
        price: z
          .integer()
          .min(0)
          .meta({
            title: String(
              tr("commerce.admin.fPrice", { default: "Prix TTC (centimes)" }),
            ),
            $control: { width: 50 },
          }),
        description: z
          .text({ maxLength: 4000 })
          .meta({
            title: String(
              tr("commerce.admin.fDescription", { default: "Description" }),
            ),
            $control: { width: 100, area: true },
          })
          .optional(),
        published: z.boolean().meta({
          title: String(
            tr("commerce.admin.fPublished", { default: "En vente" }),
          ),
          $control: { width: 100 },
        }),
      }),
    [kinds, tr],
  );

  const form = useForm({
    schema,
    initialValues: current
      ? {
          name: current.name,
          slug: current.slug,
          kind: current.kind,
          price: current.price,
          description: current.description ?? "",
          published: current.published,
        }
      : { kind: kinds[0] ?? "good", published: false, price: 0 },
    handler: async (values) => {
      if (current) {
        await client.commerceAdminProductUpdate({
          params: { id: current.id },
          body: values,
        });
      } else {
        await client.commerceAdminProductCreate({ body: values });
      }
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
            {isNew
              ? tr("commerce.admin.newProduct", { default: "Nouvelle pièce" })
              : current?.name}
          </SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-6">
          <AutoForm
            form={form}
            submitLabel={String(
              tr("commerce.admin.save", { default: "Enregistrer" }),
            )}
          />

          {current ? (
            <dl className="text-muted-foreground mt-8 grid grid-cols-2 gap-y-2 text-xs">
              <dt>
                {tr("commerce.admin.availableLabel", { default: "Disponible" })}
              </dt>
              <dd className="tabular-nums">{current.available}</dd>
              <dt>
                {tr("commerce.admin.onHandLabel", { default: "En stock" })}
              </dt>
              <dd className="tabular-nums">{current.onHand}</dd>
              <dt>
                {tr("commerce.admin.reservedLabel", { default: "Réservé" })}
              </dt>
              <dd className="tabular-nums">{current.reserved}</dd>
            </dl>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
};
