import * as React from "react";

void React;

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui";
import { useConfirmedAction } from "@alepha/ui/admin";
import { AutoForm } from "@alepha/ui/form";
import { z } from "alepha";
import { useClient } from "alepha/react";
import { FormValidationError, useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Pencil, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import type { OptionGroup } from "../../schemas/optionGroupSchema.ts";
import type {
  AdminProductController,
  AdminProductResource,
  AdminVariantResource,
} from "../controllers/AdminProductController.ts";

export interface AdminProductDetailVariantsTabProps {
  product: AdminProductResource;
  variants: AdminVariantResource[];
  /**
   * The variants or the product's stock changed.
   */
  onChanged: () => void;
}

/**
 * `Taille: 52, 54, 56`, one group per line. A text area rather than a nested
 * array of fields: a product has one or two groups, and typing them is the
 * quickest way to say them.
 */
const groupsToText = (groups: OptionGroup[]) =>
  groups.map((group) => `${group.name}: ${group.values.join(", ")}`).join("\n");

const textToGroups = (text: string): OptionGroup[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name, ...values] = line.split(":");
      return {
        name: (name ?? "").trim(),
        values: values
          .join(":")
          .split(",")
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      };
    });

const formatPrice = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    cents / 100,
  );

/**
 * What a product is sold as: its option groups, and one row per combination.
 *
 * Generating is additive. A value added to a group adds the rows it needs and
 * leaves the others, their stock and their prices alone; a value removed from a
 * group leaves its rows standing, to switch off or delete from the list.
 */
export const AdminProductDetailVariantsTab = (
  props: AdminProductDetailVariantsTabProps,
) => {
  const { product, variants, onChanged } = props;
  const client = useClient<AdminProductController>();
  const { tr } = useI18n();
  const [editing, setEditing] = useState<AdminVariantResource>();

  const schema = useMemo(
    () =>
      z.object({
        groups: z.text({ maxLength: 2000 }).meta({
          title: tr("commerce.admin.variants.fGroups", {
            default: "Options",
          }),
          description: tr("commerce.admin.variants.fGroupsHint", {
            default: "One option per line: 'Size: S, M, L'.",
          }),
        }),
      }),
    [tr],
  );

  const form = useForm(
    {
      schema,
      initialValues: { groups: groupsToText(product.optionGroups) },
      handler: async (values) => {
        const optionGroups = textToGroups(values.groups);
        if (optionGroups.some((it) => !it.name || it.values.length === 0)) {
          throw new FormValidationError({
            message: tr("commerce.admin.variants.groupsInvalid", {
              default: "Write each option as 'Name: value, value'.",
            }),
            path: "/groups",
          });
        }
        await client.commerceAdminProductUpdate({
          params: { id: product.id },
          body: { optionGroups },
        });
        await client.commerceAdminProductVariantsGenerate({
          params: { id: product.id },
        });
        onChanged();
      },
    },
    [schema, product.id],
  );

  const remove = useConfirmedAction<[AdminVariantResource]>(
    {
      confirm: (variant) => ({
        title: tr("commerce.admin.variants.deleteTitle", {
          default: "Delete this variant",
        }),
        description: tr("commerce.admin.variants.deleteConfirm", {
          default: `Permanently delete ${variant.sku}? A variant that has sold cannot be deleted: switch it off instead.`,
          args: [variant.sku],
        }),
        destructive: true,
      }),
      handler: async (variant) => {
        await client.commerceAdminProductVariantDelete({
          params: { id: product.id, variantId: variant.id },
        });
        onChanged();
      },
    },
    [client, product.id],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {tr("commerce.admin.variants.optionsTitle", {
              default: "Options",
            })}
          </CardTitle>
          <CardDescription>
            {tr("commerce.admin.variants.optionsHint", {
              default:
                "Saving writes the combinations that are missing. Existing variants keep their stock and price.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AutoForm
            form={form}
            submitLabel={tr("commerce.admin.variants.generate", {
              default: "Save and generate",
            })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {tr("commerce.admin.variants.listTitle", { default: "Variants" })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {variants.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {tr("commerce.admin.variants.empty", {
                default:
                  "This product sells as one unit. Add options above to sell it by variant.",
              })}
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {variants.map((variant) => (
                <li
                  key={variant.id}
                  className="flex items-center justify-between gap-4 py-2 text-sm"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">
                      {Object.values(
                        variant.options as Record<string, string>,
                      ).join(" / ")}
                    </span>
                    <span className="text-muted-foreground font-mono text-xs">
                      {variant.sku}
                    </span>
                  </span>
                  <span className="flex items-center gap-4">
                    {variant.active ? null : (
                      <Badge variant="secondary">
                        {tr("commerce.admin.variants.off", { default: "Off" })}
                      </Badge>
                    )}
                    <span className="tabular-nums">
                      {formatPrice(
                        variant.price ?? product.price,
                        product.currency,
                      )}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {tr("commerce.admin.variants.stockLine", {
                        default: `${variant.available} / ${variant.onHand}`,
                        args: [
                          String(variant.available),
                          String(variant.onHand),
                        ],
                      })}
                    </span>
                    <Button
                      variant="minimal"
                      size="sm"
                      aria-label={tr("commerce.admin.edit", {
                        default: "Edit",
                      })}
                      onClick={() => setEditing(variant)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="minimal"
                      size="sm"
                      aria-label={tr("commerce.admin.variants.delete", {
                        default: "Delete",
                      })}
                      disabled={remove.loading}
                      onClick={() => void remove.run(variant)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {editing ? (
        <AdminVariantSheet
          key={editing.id}
          productId={product.id}
          variant={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
};

interface AdminVariantSheetProps {
  productId: string;
  variant: AdminVariantResource;
  onClose: () => void;
  onSaved: () => void;
}

const AdminVariantSheet = (props: AdminVariantSheetProps) => {
  const { productId, variant, onClose, onSaved } = props;
  const client = useClient<AdminProductController>();
  const { tr } = useI18n();

  const schema = useMemo(
    () =>
      z.object({
        sku: z.text({ minLength: 1, maxLength: 64 }).meta({
          title: tr("commerce.admin.variants.fSku", { default: "SKU" }),
          $control: { width: 60 },
        }),
        price: z
          .integer()
          .min(0)
          .meta({
            title: tr("commerce.admin.variants.fPrice", {
              default: "Price incl. tax (cents)",
            }),
            description: tr("commerce.admin.variants.fPriceHint", {
              default: "Empty: the product's price.",
            }),
            $control: { width: 40 },
          })
          .optional(),
        weightGrams: z
          .integer()
          .min(0)
          .meta({
            title: tr("commerce.admin.variants.fWeight", {
              default: "Weight (g)",
            }),
            $control: { width: 40 },
          })
          .optional(),
        image: z
          .text({ maxLength: 500 })
          .meta({
            title: tr("commerce.admin.variants.fImage", {
              default: "Image (file id or URL)",
            }),
            $control: { width: 60 },
          })
          .optional(),
        active: z.boolean().meta({
          title: tr("commerce.admin.variants.fActive", { default: "On sale" }),
        }),
      }),
    [tr],
  );

  const form = useForm(
    {
      schema,
      initialValues: {
        sku: variant.sku,
        price: variant.price,
        weightGrams: variant.weightGrams,
        image: variant.image,
        active: variant.active,
      },
      handler: async (values) => {
        await client.commerceAdminProductVariantUpdate({
          params: { id: productId, variantId: variant.id },
          body: values,
        });
        onSaved();
      },
    },
    [schema, variant.id],
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
          <SheetTitle>{variant.sku}</SheetTitle>
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
