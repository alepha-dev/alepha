import * as React from "react";

void React;

import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { Input } from "@alepha/ui/components/ui/input";
import type { FormModel } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

export interface AdminProductDetailDetailsTabProps {
  kind: string;
  attributes: Record<string, string>;
  savingAttributes: boolean;
  onSaveAttributes: (next: Record<string, string>) => void;
  /**
   * The kind's config form, or undefined when the registered handler declares
   * no `configSchema` — in which case no config card is rendered at all.
   */
  configForm?: FormModel<any>;
  savingConfig: boolean;
}

/**
 * The two structured payloads a product carries beside its main fields.
 *
 * They look alike and are not: **attributes** are free-form display copy a
 * storefront renders (material, weight, care), untouched by the system;
 * **config** is validated by the handler that owns the product's `kind` and is
 * what `fulfil` consumes. Putting a spec sheet in `config` gets it silently
 * stripped on write — which is exactly what happened to this shop once, and why
 * the two columns exist separately. Hence one card each, and the wording below.
 *
 * Attribute values are edited as text. The column is JSON and will hold
 * anything, but a spec sheet is strings, and a free-form JSON editor here would
 * be a worse tool for the actual job.
 */
export const AdminProductDetailDetailsTab = (
  props: AdminProductDetailDetailsTabProps,
) => {
  const { tr } = useI18n();

  const [rows, setRows] = useState<Array<{ key: string; value: string }>>(() =>
    Object.entries(props.attributes ?? {}).map(([key, value]) => ({
      key,
      value: String(value),
    })),
  );

  const setRow = (
    index: number,
    patch: Partial<{ key: string; value: string }>,
  ) =>
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );

  const save = () => {
    const next: Record<string, string> = {};
    for (const row of rows) {
      // A row with no key is a half-typed line, not an attribute named "".
      if (row.key.trim()) next[row.key.trim()] = row.value;
    }
    props.onSaveAttributes(next);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {tr("commerce.admin.details.attributesTitle", {
              default: "Attributes",
            })}
          </CardTitle>
          <CardDescription>
            {tr("commerce.admin.details.attributesHint", {
              default:
                "Descriptive details the shop displays, such as material or dimensions. Not used in any calculation.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {rows.map((row, index) => (
            // rows are positional
            // and a key may legitimately be empty while it is being typed.
            <div key={index} className="flex items-center gap-2">
              <Input
                value={row.key}
                onChange={(e) => setRow(index, { key: e.target.value })}
                placeholder={String(
                  tr("commerce.admin.details.attrName", { default: "Name" }),
                )}
                className="w-1/3"
              />
              <Input
                value={row.value}
                onChange={(e) => setRow(index, { value: e.target.value })}
                placeholder={String(
                  tr("commerce.admin.details.attrValue", { default: "Value" }),
                )}
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() =>
                  setRows((current) => current.filter((_, i) => i !== index))
                }
                aria-label={String(
                  tr("commerce.admin.details.attrRemove", {
                    default: "Remove attribute",
                  }),
                )}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}

          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {tr("commerce.admin.details.attributesEmpty", {
                default: "No attribute yet.",
              })}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setRows((current) => [...current, { key: "", value: "" }])
              }
            >
              <Plus className="size-4" />
              {tr("commerce.admin.details.attrAdd", { default: "Add" })}
            </Button>
            <Button size="sm" loading={props.savingAttributes} onClick={save}>
              {tr("commerce.admin.save", { default: "Save" })}
            </Button>
          </div>
        </CardContent>
      </Card>

      {props.configForm ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {tr("commerce.admin.details.configTitle", {
                default: "Type configuration",
              })}
            </CardTitle>
            <CardDescription>
              {tr("commerce.admin.details.configHint", {
                default: `Settings the '${props.kind}' type requires. Validated when saved.`,
                args: [props.kind],
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AutoForm
              form={props.configForm}
              submitLabel={String(
                tr("commerce.admin.save", { default: "Save" }),
              )}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};
