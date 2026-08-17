import * as React from "react";

void React;

import {
  AdminDetailLayout,
  type AdminDetailTab,
} from "@alepha/ui/components/admin/admin-detail-layout";
import { useDetailTab } from "@alepha/ui/components/admin/use-detail-tab";
import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { jsonSchemaToZod, z } from "alepha";
import { useAction, useClient, useQuery } from "alepha/react";
import {
  FormValidationError,
  useFieldValue,
  useForm,
  useFormState,
} from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";
import {
  Eye,
  EyeOff,
  Images,
  Package,
  Receipt,
  Tags,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdminProductController } from "../controllers/AdminProductController.ts";
import { AdminProductDetailAside } from "./admin-product-detail-aside.tsx";
import { AdminProductDetailDetailsTab } from "./admin-product-detail-details-tab.tsx";
import { AdminProductDetailMediaTab } from "./admin-product-detail-media-tab.tsx";
import { AdminProductDetailOrdersTab } from "./admin-product-detail-orders-tab.tsx";
import { AdminProductDetailOverviewTab } from "./admin-product-detail-overview-tab.tsx";
import { AdminProductDetailStockTab } from "./admin-product-detail-stock-tab.tsx";
import { imagesFormSchema } from "./images-form-schema.ts";
import { productFormSchema } from "./product-form-schema.ts";
import { stockAdjustSchema } from "./stock-adjust-schema.ts";

export interface AdminProductDetailProps {
  /**
   * Path of the catalogue list, for the "not found" way back. Defaults to
   * `/admin/products`; an application whose list lives elsewhere passes its own.
   */
  backPath?: string;
}

type TabKey = "overview" | "media" | "details" | "stock" | "orders";

/**
 * Composition root for the product detail page.
 *
 * Owns the data — queries, forms, mutations — and hands each tab what it needs.
 * The tabs render and fetch nothing themselves, which is what keeps a page with
 * five of them readable.
 *
 * ### Why a page and not a drawer
 *
 * The drawer this replaces reached six of the product entity's fields.
 * `currency`, `vatRateBps`, `images`, `attributes` and `config` had no UI at
 * all — and `vatRateBps` was not even accepted by the API, so a mixed-rate
 * catalogue was impossible however anyone tried. That is more than a drawer
 * holds.
 *
 * ### Several forms, not one
 *
 * Overview, Media, Stock and the kind's config each own a form. They submit to
 * different endpoints and have different lifetimes — `ControlUpload` writes as
 * uploads land, so sharing the editor's form would leave it dirty and let its
 * Reset discard an upload that already happened.
 */
export const AdminProductDetail = (props: AdminProductDetailProps) => {
  const router = useRouter();
  const routerState = useRouterState();
  const productId = String(
    (routerState.params as { productId?: string; id?: string }).productId ??
      (routerState.params as { id?: string }).id ??
      "",
  );
  const client = useClient<AdminProductController>();
  const { tr } = useI18n();
  const toast = useToast();
  const dialog = useDialog();

  const [tab, setTab] = useDetailTab<TabKey>("overview");
  const [movementsSignal, setMovementsSignal] = useState(0);
  const backPath = props.backPath ?? "/admin/products";

  // -- Load ------------------------------------------------------------------

  const productQuery = useQuery(
    {
      handler: ({ signal }) =>
        client.commerceAdminProductGet(
          { params: { id: productId } },
          { request: { signal } },
        ),
      onError: (err) => {
        toast.error(
          String(
            tr("commerce.admin.detail.loadError", {
              default: "Failed to load the product",
            }),
          ),
        );
        console.error(err);
      },
    },
    [client, productId],
  );
  const product = productQuery.data;

  const kindsQuery = useQuery(
    {
      key: ["commerce", "product-kinds"],
      staleTime: [10, "minutes"],
      handler: () => client.commerceAdminProductKinds({}),
      // Kind metadata only shapes the pickers — a failure must not block.
      onError: () => {},
    },
    [client],
  );
  const kinds = kindsQuery.data?.kinds ?? [];
  const configSchemas = kindsQuery.data?.schemas ?? {};

  // -- Overview form ---------------------------------------------------------

  /*
   * `kinds.join()` rather than `kinds` itself: `kindsQuery.data?.kinds ?? []`
   * yields a fresh array on every render until the query resolves, so the array
   * as a dependency would rebuild the schema — and, through the form's `deps`
   * below, the form — on every single render.
   */
  const kindsKey = kinds.join(",");
  const schema = useMemo(
    () => productFormSchema(tr, kinds, product?.currency),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tr, kindsKey, product?.currency],
  );

  const form = useForm(
    {
      schema,
      initialValues: {
        name: product?.name ?? "",
        slug: product?.slug ?? "",
        kind: product?.kind ?? kinds[0] ?? "good",
        price: product?.price ?? 0,
        currency: product?.currency ?? "EUR",
        vatRateBps: product?.vatRateBps,
        description: product?.description ?? "",
        published: product?.published ?? false,
      },
      handler: async (values) => {
        /*
         * Emptiness is checked here rather than in the schema — see the note in
         * `product-form-schema.ts`. A schema-level `minLength` crashes the page
         * on its empty first render, long before anyone types anything.
         */
        if (!values.name.trim()) {
          throw new FormValidationError({
            message: String(
              tr("commerce.admin.nameRequired", {
                default: "Name is required",
              }),
            ),
            path: "/name",
          });
        }
        if (!values.slug.trim()) {
          throw new FormValidationError({
            message: String(
              tr("commerce.admin.slugRequired", {
                default: "Reference is required",
              }),
            ),
            path: "/slug",
          });
        }

        await client.commerceAdminProductUpdate({
          params: { id: productId },
          body: values,
        });
        toast.success(
          String(tr("commerce.admin.saved", { default: "Product saved." })),
        );
        await productQuery.refetch();
      },
    },
    /*
     * Rebuild the model when the schema changes.
     *
     * `useForm` memoises on these deps and captures the schema once — with the
     * default `[]` the form is built on the first render, when the kind list has
     * not arrived, and the Type picker is left with no options for the life of
     * the page. The values survive: the effect below re-anchors them from the
     * loaded product.
     */
    [schema],
  );

  // Re-anchor on the server snapshot whenever the product reloads, so
  // AutoForm's Reset returns to what was saved rather than to the empty values
  // captured at mount.
  useEffect(() => {
    if (!product) return;
    form.setInitialValues({
      name: product.name,
      slug: product.slug,
      kind: product.kind,
      price: product.price,
      currency: product.currency,
      vatRateBps: product.vatRateBps,
      description: product.description ?? "",
      published: product.published,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productQuery.data]);

  // -- Media form ------------------------------------------------------------

  const imagesForm = useForm({
    schema: imagesFormSchema,
    initialValues: { images: product?.images ?? [] },
    handler: async (values) => {
      await client.commerceAdminProductUpdate({
        params: { id: productId },
        body: { images: values.images },
      });
      toast.success(
        String(tr("commerce.admin.media.saved", { default: "Images saved." })),
      );
      await productQuery.refetch();
    },
  });

  useEffect(() => {
    if (!product) return;
    imagesForm.setInitialValues({ images: product.images ?? [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productQuery.data]);

  /*
   * Subscribed rather than read off the field, so the preview grid re-renders
   * when `ControlUpload` writes an id after an upload finishes and when the
   * arrows reorder — neither of which is a React state change of this
   * component's own.
   */
  const [imagesValue, setImagesValue] = useFieldValue(imagesForm.input.images);
  const images = (imagesValue as string[] | undefined) ?? [];
  const { loading: imagesSaving } = useFormState(imagesForm, ["loading"]);

  // -- Kind config form ------------------------------------------------------

  /*
   * The handler's `configSchema` arrives as JSON Schema — a zod schema cannot
   * be serialised — and is rebuilt here with `jsonSchemaToZod`, the same
   * round-trip `api/parameters` and `api/analytics` use for exactly this.
   *
   * Falls back to an empty object so the hook below is called unconditionally;
   * `hasConfig` is what decides whether the card renders at all.
   */
  const currentKind = product?.kind ?? "";
  const configJsonSchema = configSchemas[currentKind];
  const hasConfig = Boolean(configJsonSchema);
  const configSchema = useMemo(
    () =>
      configJsonSchema
        ? (jsonSchemaToZod(configJsonSchema) as any)
        : z.object({}),
    [configJsonSchema],
  );

  const configForm = useForm(
    {
      schema: configSchema,
      initialValues: (product?.config as Record<string, any>) ?? {},
      handler: async (values: Record<string, any>) => {
        await client.commerceAdminProductUpdate({
          params: { id: productId },
          body: { config: values },
        });
        toast.success(
          String(
            tr("commerce.admin.details.configSaved", {
              default: "Configuration saved.",
            }),
          ),
        );
        await productQuery.refetch();
      },
    },
    /*
     * Same reason as the overview form, and here it was the whole card: the
     * kind's schema arrives with the kinds query, so a form built on the first
     * render holds `z.object({})` and `AutoForm` renders a submit button over no
     * fields at all.
     */
    [configJsonSchema],
  );

  useEffect(() => {
    if (!product) return;
    configForm.setInitialValues((product.config as Record<string, any>) ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productQuery.data, configJsonSchema]);

  const { loading: configSaving } = useFormState(configForm, ["loading"]);

  // -- Attributes ------------------------------------------------------------

  const saveAttributes = useAction<[Record<string, string>]>(
    {
      handler: async (attributes) => {
        await client.commerceAdminProductUpdate({
          params: { id: productId },
          body: { attributes },
        });
        toast.success(
          String(
            tr("commerce.admin.details.attributesSaved", {
              default: "Attributes saved.",
            }),
          ),
        );
        await productQuery.refetch();
      },
    },
    [client, productId],
  );

  // -- Stock -----------------------------------------------------------------

  const adjustSchema = useMemo(() => stockAdjustSchema(tr), [tr]);

  const adjustForm = useForm({
    schema: adjustSchema,
    initialValues: { quantity: 1, reason: "intake" as const },
    handler: async (values) => {
      await client.commerceAdminProductAdjustStock({
        params: { id: productId },
        body: values,
      });
      toast.success(
        String(
          tr("commerce.admin.stock.adjusted", { default: "Stock updated." }),
        ),
      );
      // Both the figures (aside + cards) and the ledger below have changed.
      await productQuery.refetch();
      setMovementsSignal((n) => n + 1);
    },
  });

  const movementsFetcher = useCallback(
    (params: { page: number; size: number }) =>
      client.commerceAdminProductMovements({
        params: { id: productId },
        query: { page: params.page, size: params.size },
      }),
    [client, productId],
  );

  const ordersFetcher = useCallback(
    (params: { page: number; size: number }) =>
      client.commerceAdminProductOrders({
        params: { id: productId },
        query: { page: params.page, size: params.size },
      }),
    [client, productId],
  );

  // -- Publish / delete ------------------------------------------------------

  const togglePublished = useAction(
    {
      handler: async () => {
        if (!product) return;
        await client.commerceAdminProductPublish({
          params: { id: productId },
          body: { published: !product.published },
        });
        await productQuery.refetch();
      },
    },
    [client, productId, product?.published],
  );

  const deleteProduct = useAction(
    {
      handler: async () => {
        if (!product) return;
        const ok = await dialog.confirm({
          title: String(
            tr("commerce.admin.detail.deleteTitle", {
              default: "Delete product",
            }),
          ),
          description: String(
            tr("commerce.admin.detail.deleteConfirm", {
              default: `Permanently delete “${product.name}”? This cannot be undone.`,
              args: [product.name],
            }),
          ),
          destructive: true,
          confirmLabel: String(
            tr("commerce.admin.detail.deleteCta", { default: "Delete" }),
          ),
        });
        if (!ok) return;

        try {
          await client.commerceAdminProductDelete({
            params: { id: productId },
          });
        } catch (error) {
          /*
           * The server refuses (409) once the product appears on an order line,
           * and its message says why and what to do instead. Surfacing it
           * verbatim beats a generic failure toast — "unpublish it" is the
           * actionable half.
           */
          toast.error(
            (error as Error)?.message ??
              String(
                tr("commerce.admin.detail.deleteError", {
                  default: "Could not delete this product",
                }),
              ),
          );
          return;
        }

        toast.success(
          String(
            tr("commerce.admin.detail.deleted", {
              default: "Product deleted.",
            }),
          ),
        );
        await router.push(backPath);
      },
    },
    [client, productId, product?.name],
  );

  // -- Render ----------------------------------------------------------------

  const tabs: AdminDetailTab[] = [
    {
      value: "overview",
      icon: Package,
      label: tr("commerce.admin.detail.tabOverview", { default: "Overview" }),
    },
    {
      value: "media",
      icon: Images,
      label: tr("commerce.admin.detail.tabMedia", { default: "Images" }),
    },
    {
      value: "details",
      icon: Tags,
      label: tr("commerce.admin.detail.tabDetails", { default: "Details" }),
    },
    {
      value: "stock",
      icon: Package,
      label: tr("commerce.admin.detail.tabStock", { default: "Stock" }),
    },
    {
      value: "orders",
      icon: Receipt,
      label: tr("commerce.admin.detail.tabOrders", { default: "Orders" }),
    },
  ];

  return (
    <AdminDetailLayout
      loading={productQuery.loading && !product}
      notFound={
        product
          ? undefined
          : {
              message: String(
                tr("commerce.admin.detail.notFound", {
                  default: "Product not found.",
                }),
              ),
              backLabel: String(
                tr("commerce.admin.detail.back", {
                  default: "Back to the catalogue",
                }),
              ),
              onBack: () => void router.push(backPath),
            }
      }
      aside={product ? <AdminProductDetailAside product={product} /> : null}
      tabs={tabs}
      tab={tab}
      onTabChange={(v) => setTab(v as TabKey)}
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            loading={togglePublished.loading}
            onClick={() => togglePublished.run()}
          >
            {product?.published ? (
              <>
                <EyeOff className="size-4" />
                {tr("commerce.admin.unpublish", {
                  default: "Remove from sale",
                })}
              </>
            ) : (
              <>
                <Eye className="size-4" />
                {tr("commerce.admin.publish", { default: "Put on sale" })}
              </>
            )}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            loading={deleteProduct.loading}
            onClick={() => deleteProduct.run()}
          >
            <Trash2 className="size-4" />
            {tr("commerce.admin.detail.delete", { default: "Delete" })}
          </Button>
        </>
      }
    >
      {tab === "overview" && <AdminProductDetailOverviewTab form={form} />}

      {tab === "media" && (
        <AdminProductDetailMediaTab
          form={imagesForm}
          images={images}
          onReorder={setImagesValue}
          saving={imagesSaving}
          onSave={() => void imagesForm.submit()}
        />
      )}

      {tab === "details" && product && (
        <AdminProductDetailDetailsTab
          key={product.updatedAt}
          kind={product.kind}
          attributes={(product.attributes as Record<string, string>) ?? {}}
          savingAttributes={saveAttributes.loading}
          onSaveAttributes={(next) => void saveAttributes.run(next)}
          configForm={hasConfig ? configForm : undefined}
          savingConfig={configSaving}
        />
      )}

      {tab === "stock" && product && (
        <AdminProductDetailStockTab
          product={product}
          form={adjustForm}
          fetch={movementsFetcher}
          refreshSignal={movementsSignal}
        />
      )}

      {tab === "orders" && (
        <AdminProductDetailOrdersTab
          productId={productId}
          fetch={ordersFetcher}
        />
      )}
    </AdminDetailLayout>
  );
};

export default AdminProductDetail;
