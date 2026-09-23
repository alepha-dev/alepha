import * as React from "react";

void React;

import type { ZObject } from "alepha";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useMemo, useState } from "react";

import { Badge } from "../core/Badge.tsx";
import { AutoForm } from "../form/AutoForm.tsx";
import type { ControlProps } from "../form/Control.tsx";
import { parameterLabel } from "./adminParametersTree.ts";
import { ParameterSaveDialog } from "./ParameterSaveDialog.tsx";

export interface AdminParametersEditorFormProps {
  /**
   * Per-field overrides forwarded to AutoForm (domain widgets).
   */
  fields?: Record<string, Partial<Omit<ControlProps, "input">>>;
  /**
   * `$parameter({ description })` as declared in code.
   */
  declaredDescription?: string;
  name: string;
  schema: ZObject;
  initial: Record<string, unknown>;
  schemaHash?: string;
  currentVersion?: number;
  initialTags?: string[];
  onSubmit: (
    content: unknown,
    meta: { tags: string[]; activationDate?: string },
  ) => Promise<void>;
  onFactoryReset: () => void | Promise<void>;
  factoryResetLoading?: boolean;
  onExport: () => void;
}

export const AdminParametersEditorForm = (
  props: AdminParametersEditorFormProps,
) => {
  // `lang` is in the deps of every memo below on purpose: `tr` is a stable
  // method on the injected provider, so switching language re-renders but
  // would otherwise hand back the previously memoised (wrong-language) copy.
  const { tr, lang } = useI18n();
  // Saving is a two-step flow: the AutoForm submit captures the edited content
  // and opens the save dialog, which collects tags before the version is
  // actually persisted via onSubmit.
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const form = useForm(
    {
      schema: props.schema,
      initialValues: props.initial as Record<string, any>,
      handler: async (values) => {
        setPending(values);
      },
    },
    [props.name, props.schemaHash],
  );
  const title = useMemo(
    () => parameterLabel(tr, props.name),
    [props.name, tr, lang],
  );
  /**
   * What this parameter IS, in order of preference: the dictionary
   * (`parameters.<name>.desc`, so it can be translated and edited without a
   * deploy), then the `description` declared on the `$parameter`, then the
   * tree path as a last resort. A key like "reducedFactor" means nothing to
   * an operator — this line is what turns the panel into documentation.
   */
  const description = useMemo(() => {
    const key = `parameters.${props.name}.desc`;
    const translated = tr(key, { default: "" });
    if (translated && translated !== key) return translated;
    return props.declaredDescription || undefined;
  }, [props.name, props.declaredDescription, tr, lang]);

  const breadcrumb = useMemo(() => {
    const parts = props.name.split(".");
    parts.pop();
    // Each ancestor folder by its cumulative path (`parameters.courts`),
    // through the same lookup the tree uses, so the two never disagree.
    return parts
      .map((_, i) => parameterLabel(tr, parts.slice(0, i + 1).join(".")))
      .join(" / ");
  }, [props.name, tr, lang]);

  return (
    <div className="flex min-h-0 flex-col">
      <AutoForm
        form={form}
        fields={props.fields as never}
        fill
        card="rounded-none ring-0 border-y"
        // Two columns, not three: every field now carries help text under it,
        // and a third of a row turns that help into an unreadable ribbon.
        gridClassName="grid-cols-1 lg:grid-cols-2"
        icon="cog"
        title={title}
        description={description ?? breadcrumb ?? undefined}
        i18nPrefix={`parameters.${props.name}`}
        headerAction={
          props.currentVersion != null ? (
            <Badge variant="secondary">v{props.currentVersion}</Badge>
          ) : undefined
        }
        autoGroup
        disabledIfPristine
        skipReset
        submitLabel={tr("admin.parameters.save", {
          default: "Save new version",
        })}
        actions={[
          {
            label: tr("admin.parameters.factoryReset", {
              default: "Factory reset",
            }),
            icon: "wrench",
            variant: "outlined",
            onClick: props.onFactoryReset,
            disabled: props.factoryResetLoading,
          },
          {
            label: tr("admin.parameters.export", { default: "Export" }),
            icon: "download",
            variant: "outlined",
            onClick: props.onExport,
          },
        ]}
      />
      <ParameterSaveDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        initialTags={props.initialTags}
        onConfirm={async (meta) => {
          if (pending) await props.onSubmit(pending, meta);
          setPending(null);
        }}
      />
    </div>
  );
};
