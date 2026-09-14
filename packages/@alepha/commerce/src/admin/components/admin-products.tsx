import * as React from "react";

void React;

import { Badge, Button, useToast } from "@alepha/ui";
import { AdminPage, useConfirmedAction } from "@alepha/ui/admin";
import {
  AlephaTable,
  type AlephaTableFilterFields,
  type AlephaTableFilterValues,
} from "@alepha/ui/table";
import { z } from "alepha";
import { useAction, useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Eye, EyeOff, PackagePlus, Pencil, Plus, Shapes } from "lucide-react";
import { useCallback } from "react";

import type {
  AdminProductController,
  AdminProductResource,
} from "../controllers/AdminProductController.ts";

const formatPrice = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    (cents ?? 0) / 100,
  );

/**
 * Toolbar filter. Module scope so its identity stays stable across renders —
 * `AlephaTable` owns a `useForm` over it, and a fresh reference each render would
 * re-anchor that form for nothing.
 */
export interface AdminProductsProps {
  /**
   * Where a product's detail page lives. The route belongs to the application —
   * this package registers no pages — so the path it mounted it at is passed in.
   * `:productId` is appended. Defaults to `/admin/products`.
   */
  detailPath?: string;
}

/**
 * Catalogue management: list, publish, restock, and the way in to a product.
 *
 * Shows **available** stock rather than on-hand, with held units called out
 * separately: "3 in stock" is misleading when two are already in someone else's
 * checkout, and restocking decisions are made from what is sellable.
 *
 * ### There is no editor here, and no create form
 *
 * Both used to be a `Sheet` over this list. The sheet reached six of the
 * product entity's fields and had no room for the rest — images, tax rate,
 * attributes, per-kind config — so editing moved to a page of its own.
 *
 * With the editor gone there is nowhere a create form belongs either, so
 * "New product" writes a draft immediately (`product-N`, unpublished, at zero)
 * and opens it. Naming and pricing happen on the page that opens, which is
 * where the operator was going anyway.
 */
export const AdminProducts = (props: AdminProductsProps) => {
  const client = useClient<AdminProductController>();
  const router = useRouter();
  const { l, tr } = useI18n();
  const toast = useToast();

  const detailPath = props.detailPath ?? "/admin/products";
  const openProduct = (id: string) => void router.push(`${detailPath}/${id}`);

  const createDraft = useAction(
    {
      handler: async () => {
        const draft = await client.commerceAdminProductDraft({});
        openProduct(draft.id);
      },
      onError: () =>
        toast.error(
          tr("commerce.admin.draftFailed", {
            default: "Could not create the product",
          }),
        ),
    },
    [client, detailPath],
  );

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

  /**
   * The table's only filter, so it is on the bar from the start: a default
   * filter, removable like any other. The kinds are this deployment's, read
   * from the server rather than hard-coded, and labelled as they are named.
   */
  const filterFields = {
    kind: {
      schema: z.string(),
      mode: "default",
      label: tr("commerce.admin.colKind", { default: "Type" }),
      icon: Shapes,
      items: (kinds?.kinds ?? []).map((kind) => ({ value: kind, label: kind })),
      control: {
        clearLabel: tr("commerce.admin.allKinds", { default: "All types" }),
      },
    },
  } satisfies AlephaTableFilterFields;

  const fetcher = useCallback(
    async (params: {
      page: number;
      size: number;
      sort?: string;
      filters?: AlephaTableFilterValues<typeof filterFields>;
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
                default: "Remove from sale",
              })
            : tr("commerce.admin.publishTitle", { default: "Put on sale" }),
        ),
        description: String(
          product.published
            ? tr("commerce.admin.unpublishConfirm", {
                default: `“${product.name}” will disappear from the shop. Orders already placed are unchanged.`,
                args: [product.name],
              })
            : tr("commerce.admin.publishConfirm", {
                default: `“${product.name}” will be visible and purchasable.`,
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
        title: tr("commerce.admin.restockTitle", { default: "Restock" }),
        description: tr("commerce.admin.restockConfirm", {
          default: `Add one unit of “${product.name}” to stock?`,
          args: [product.name],
        }),
      }),
      // Deliberately +1 rather than a quantity prompt: a dialog that asks for a
      // number is a form, and forms belong in the editor. One click covers the
      // common case — one unit came back from the workshop.
      handler: async (product, refresh) => {
        await client.commerceAdminProductRestock({
          params: { id: product.id },
          body: { quantity: 1 },
        });
        refresh();
      },
      success: (product) =>
        tr("commerce.admin.restocked", {
          default: `“${product.name}”: +1 in stock.`,
          args: [product.name],
        }),
    },
    [client],
  );

  return (
    <AdminPage>
      <AlephaTable<AdminProductResource, typeof filterFields>
        className="min-h-0 flex-1"
        persistenceKey="commerce.admin.products"
        fetch={fetcher}
        onRowClick={(product) => openProduct(product.id)}
        emptyMessage={tr("commerce.admin.noProducts", {
          default: "No products in the catalogue.",
        })}
        filters={{ fields: filterFields }}
        toolbar={
          <Button
            size="sm"
            loading={createDraft.loading}
            onClick={() => createDraft.run()}
          >
            <Plus className="size-4" />
            {tr("commerce.admin.newProduct", { default: "New product" })}
          </Button>
        }
        rowActions={(product) => [
          {
            label: tr("commerce.admin.edit", { default: "Edit" }),
            icon: Pencil,
            onClick: (item) => openProduct(item.id),
          },
          {
            label: String(
              product.published
                ? tr("commerce.admin.unpublish", {
                    default: "Remove from sale",
                  })
                : tr("commerce.admin.publish", { default: "Put on sale" }),
            ),
            icon: product.published ? EyeOff : Eye,
            destructive: product.published,
            onClick: (item, ctx) => void publish.run(item, ctx.refresh),
          },
          {
            label: tr("commerce.admin.restock", { default: "Restock" }),
            icon: PackagePlus,
            onClick: (item, ctx) => void restock.run(item, ctx.refresh),
          },
        ]}
        columns={{
          name: {
            label: tr("commerce.admin.colName", { default: "Product" }),
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
            label: tr("commerce.admin.colPrice", { default: "Price" }),
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
                    {tr("commerce.admin.reserved", { default: "reserved" })})
                  </span>
                ) : null}
              </span>
            ),
          },
          published: {
            label: tr("commerce.admin.colStatus", { default: "Status" }),
            cell: (p) =>
              p.published ? (
                <Badge>
                  {tr("commerce.admin.online", { default: "Online" })}
                </Badge>
              ) : (
                <Badge variant="secondary">
                  {tr("commerce.admin.draft", { default: "Draft" })}
                </Badge>
              ),
          },
          createdAt: {
            label: tr("commerce.admin.colCreated", { default: "Added" }),
            sortable: true,
            cell: (p) => (
              <span className="text-muted-foreground text-xs">
                {l(p.createdAt, { date: "lll" })}
              </span>
            ),
          },
        }}
      />
    </AdminPage>
  );
};
