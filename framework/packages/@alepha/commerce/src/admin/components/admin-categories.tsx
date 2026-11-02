import * as React from "react";

void React;

import {
  Badge,
  Button,
  Card,
  CardContent,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui";
import { AdminPage, useConfirmedAction } from "@alepha/ui/admin";
import { AutoForm } from "@alepha/ui/form";
import { z } from "alepha";
import { useClient, useQuery } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import type { CategoryEntity } from "../../entities/categories.ts";
import type { AdminCategoryController } from "../controllers/AdminCategoryController.ts";

/**
 * Parents before their children, indented by depth: a shop has dozens of
 * categories, and a tree widget would be more chrome than content.
 */
const flatten = (
  all: CategoryEntity[],
  parentId?: string,
  depth = 0,
): Array<{ category: CategoryEntity; depth: number }> =>
  all
    .filter((it) => it.parentId === parentId)
    .flatMap((category) => [
      { category, depth },
      ...flatten(all, category.id, depth + 1),
    ]);

/**
 * The catalogue's shelves.
 */
export const AdminCategories = () => {
  const client = useClient<AdminCategoryController>();
  const { tr } = useI18n();
  const [editing, setEditing] = useState<CategoryEntity | "new">();

  const categoriesQuery = useQuery(
    { handler: () => client.commerceAdminCategoryList({}) },
    [client],
  );
  const all = categoriesQuery.data ?? [];

  const remove = useConfirmedAction<[CategoryEntity]>(
    {
      confirm: (category) => ({
        title: tr("commerce.admin.categories.deleteTitle", {
          default: "Delete this category",
        }),
        description: tr("commerce.admin.categories.deleteConfirm", {
          default: `Permanently delete “${category.name}”? A category that still holds products cannot be deleted.`,
          args: [category.name],
        }),
        destructive: true,
      }),
      handler: async (category) => {
        await client.commerceAdminCategoryDelete({
          params: { id: category.id },
        });
        await categoriesQuery.refetch();
      },
    },
    [client],
  );

  return (
    <AdminPage>
      <div className="mb-4 flex justify-end">
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="size-4" />
          {tr("commerce.admin.categories.new", { default: "New category" })}
        </Button>
      </div>

      <Card>
        <CardContent>
          {all.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {tr("commerce.admin.categories.empty", {
                default: "No category yet.",
              })}
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {flatten(all).map(({ category, depth }) => (
                <li
                  key={category.id}
                  className="flex items-center justify-between gap-4 py-2 text-sm"
                  style={{ paddingLeft: `${depth * 1.5}rem` }}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{category.name}</span>
                    <span className="text-muted-foreground font-mono text-xs">
                      {category.slug}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {category.published ? null : (
                      <Badge variant="secondary">
                        {tr("commerce.admin.draft", { default: "Draft" })}
                      </Badge>
                    )}
                    <Button
                      variant="minimal"
                      size="sm"
                      aria-label={tr("commerce.admin.edit", {
                        default: "Edit",
                      })}
                      onClick={() => setEditing(category)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="minimal"
                      size="sm"
                      aria-label={tr("commerce.admin.categories.delete", {
                        default: "Delete",
                      })}
                      disabled={remove.loading}
                      onClick={() => void remove.run(category)}
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
        <AdminCategorySheet
          key={editing === "new" ? "new" : editing.id}
          category={editing === "new" ? undefined : editing}
          all={all}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void categoriesQuery.refetch();
          }}
        />
      ) : null}
    </AdminPage>
  );
};

interface AdminCategorySheetProps {
  category?: CategoryEntity;
  all: CategoryEntity[];
  onClose: () => void;
  onSaved: () => void;
}

const AdminCategorySheet = (props: AdminCategorySheetProps) => {
  const { category, all, onClose, onSaved } = props;
  const client = useClient<AdminCategoryController>();
  const { tr } = useI18n();

  const schema = useMemo(
    () =>
      z.object({
        name: z.text({ maxLength: 200 }).meta({
          title: tr("commerce.admin.categories.fName", { default: "Name" }),
          $control: { width: 60 },
        }),
        slug: z.text({ maxLength: 200 }).meta({
          title: tr("commerce.admin.categories.fSlug", {
            default: "Reference",
          }),
          $control: { width: 40 },
        }),
        parentId: z
          .text()
          .meta({
            title: tr("commerce.admin.categories.fParent", {
              default: "Under",
            }),
            $control: {
              width: 60,
              items: all
                .filter((it) => it.id !== category?.id)
                .map((it) => ({ value: it.id, label: it.name })),
            },
          })
          .optional(),
        position: z
          .integer()
          .meta({
            title: tr("commerce.admin.categories.fPosition", {
              default: "Position",
            }),
            $control: { width: 40 },
          })
          .optional(),
        description: z
          .text({ maxLength: 4000 })
          .meta({
            title: tr("commerce.admin.categories.fDescription", {
              default: "Description",
            }),
          })
          .optional(),
        published: z.boolean().meta({
          title: tr("commerce.admin.categories.fPublished", {
            default: "Visible in the shop",
          }),
        }),
      }),
    [tr, category?.id, all],
  );

  const form = useForm(
    {
      schema,
      initialValues: {
        name: category?.name ?? "",
        slug: category?.slug ?? "",
        parentId: category?.parentId,
        position: category?.position,
        description: category?.description,
        published: category?.published ?? true,
      },
      handler: async (values) => {
        const body = { ...values, parentId: values.parentId };
        if (category) {
          await client.commerceAdminCategoryUpdate({
            params: { id: category.id },
            body,
          });
        } else {
          await client.commerceAdminCategoryCreate({ body });
        }
        onSaved();
      },
    },
    [schema],
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
            {category?.name ??
              tr("commerce.admin.categories.new", {
                default: "New category",
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
