import * as React from "react";

void React;

import { jsonSchemaToZod, type ZObject } from "alepha";
import type { AdminParameterController } from "alepha/api/parameters";
import { useAction, useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Settings2 } from "lucide-react";
import { useState } from "react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../core/Empty.tsx";
import { Skeleton } from "../core/Skeleton.tsx";
import { useToast } from "../core/useToast.tsx";
import type { ControlProps } from "../form/Control.tsx";
import { AdminParametersEditorForm } from "./AdminParametersEditorForm.tsx";
import { downloadJson } from "./downloadJson.ts";
import { ParameterDiffDialog } from "./ParameterDiffDialog.tsx";

// ── Pane B: editor ───────────────────────────────────────────────────

export interface AdminParametersEditorPaneProps {
  /**
   * Per-field overrides for this parameter's generated form.
   */
  fields?: Record<string, Partial<Omit<ControlProps, "input">>>;
  name: string | undefined;
  reloadKey: number;
  onSaved: () => void;
}

export const AdminParametersEditorPane = (
  props: AdminParametersEditorPaneProps,
) => {
  const client = useClient<AdminParameterController>();
  const { tr } = useI18n();
  const toast = useToast();

  const { data: current } = useQuery(
    {
      handler: () => client.getCurrent({ params: { name: props.name! } }),
      enabled: !!props.name,
    },
    [client, props.name, props.reloadKey],
  );

  // Factory reset is a write mutation — runs through useAction so the action
  // button can disable while it's in flight. Reads `current` at call time
  // (the hook must sit above the early returns below).
  const factoryReset = useAction(
    {
      handler: async () => {
        if (!props.name || !current) return;
        await client.createVersion({
          params: { name: props.name },
          body: {
            content: (current.defaultValue ?? {}) as Record<string, any>,
            changeDescription: "Factory reset to compiled defaults",
          },
        });
        toast.success(
          tr("admin.parameters.factoryResetDone", {
            default: "Parameter reset to defaults",
          }),
        );
        props.onSaved();
      },
    },
    [client, props.name, current],
  );

  // Factory reset is gated behind a confirm dialog that previews the diff
  // between the current effective value and the compiled defaults.
  const [resetOpen, setResetOpen] = useState(false);

  if (!props.name) {
    // No selection → history pane is hidden, so the editor is the rightmost
    // pane and closes the card on its right edge.
    return (
      <div className="bg-card flex flex-1 items-center justify-center rounded-r-lg border-y border-r p-6">
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Settings2 className="size-4" />
            </EmptyMedia>
            <EmptyTitle>
              {tr("admin.parameters.emptyTitle", {
                default: "No parameter selected",
              })}
            </EmptyTitle>
            <EmptyDescription>
              {tr("admin.parameters.emptySelection", {
                default: "Pick a parameter on the left to edit it.",
              })}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }
  if (!current) {
    return (
      <div className="bg-card flex min-h-0 flex-1 flex-col border-y">
        <div className="flex items-center gap-3 border-b px-4 pt-3 pb-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2 xl:grid-cols-3">
          {["f1", "f2", "f3", "f4"].map((k) => (
            <div key={k} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const data = current;
  const schema = data.schema
    ? (jsonSchemaToZod(data.schema as any) as ZObject)
    : (jsonSchemaToZod({
        type: "object",
        properties: {},
      }) as ZObject);
  const initial =
    (data.current?.content as Record<string, unknown> | undefined) ??
    (data.currentValue as Record<string, unknown> | undefined) ??
    (data.defaultValue as Record<string, unknown> | undefined) ??
    {};

  const exportContent =
    data.current?.content ?? data.currentValue ?? data.defaultValue ?? {};

  return (
    <>
      <AdminParametersEditorForm
        name={props.name}
        fields={props.fields}
        declaredDescription={data.description}
        schema={schema}
        initial={initial}
        schemaHash={data.current?.schemaHash}
        currentVersion={data.current?.version}
        initialTags={data.current?.tags ?? undefined}
        onSubmit={async (content, meta) => {
          await client.createVersion({
            params: { name: props.name! },
            body: {
              content: content as Record<string, any>,
              tags: meta.tags.length > 0 ? meta.tags : undefined,
              activationDate: meta.activationDate,
            },
          });
          props.onSaved();
        }}
        onFactoryReset={() => setResetOpen(true)}
        factoryResetLoading={factoryReset.loading}
        onExport={() => {
          downloadJson(
            [{ name: props.name!, content: exportContent }],
            `${props.name}.json`,
          );
        }}
      />
      <ParameterDiffDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={tr("admin.parameters.factoryResetTitle", {
          default: "Factory reset",
        })}
        description={tr("admin.parameters.factoryResetConfirm", {
          default:
            "Reset to compiled defaults? The change below will be saved as a new version.",
        })}
        previous={initial}
        current={data.defaultValue ?? {}}
        confirm={{
          label: tr("admin.parameters.factoryReset", {
            default: "Factory reset",
          }),
          destructive: true,
          loading: factoryReset.loading,
          onConfirm: async () => {
            await factoryReset.run();
            setResetOpen(false);
          },
        }}
      />
    </>
  );
};
