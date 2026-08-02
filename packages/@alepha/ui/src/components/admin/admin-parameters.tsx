import * as React from "react";

void React;

import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import type { ControlProps } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@alepha/ui/components/ui/empty";
import { Skeleton } from "@alepha/ui/components/ui/skeleton";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { cn } from "@alepha/ui/lib/utils";
import { jsonSchemaToZod, type ZObject, z } from "alepha";
import type { AdminParameterController } from "alepha/api/parameters";
import { useAction, useClient, useQuery } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useQueryParams } from "alepha/react/router";
import {
  ChevronRight,
  Download,
  FileCog,
  History as HistoryIcon,
  Settings2,
  Upload,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ParameterDiffDialog } from "./parameter-diff-dialog.tsx";
import { ParameterHistoryItem } from "./parameter-history-item.tsx";
import { ParameterSaveDialog } from "./parameter-save-dialog.tsx";

/**
 * Three-pane admin parameters editor:
 *
 *   [ tree ][   AutoForm on current version   ][ history ]
 *
 * - Left:   collapsible tree of every registered parameter name. Dot-notation
 *           (`lore.campaign.limits`) becomes a folder hierarchy. Leaves are
 *           clickable; clicking sets the active parameter.
 * - Center: AutoForm bound to the parameter's runtime schema and pre-filled
 *           with the current effective value. "Save new version" opens a dialog
 *           to attach tags, then creates an immediate version via
 *           `createVersion`.
 * - Right:  reverse-chronological history. Each version is a collapsible card
 *           (see `ParameterHistoryItem`) with a `…` menu to view its JSON, diff
 *           it against the previous version, or roll back to it.
 */
const parameterQuerySchema = z.object({ param: z.string().optional() });

export interface AdminParametersProps {
  /**
   * Per-parameter field overrides, keyed by parameter name, forwarded to the
   * generated form (same shape as `AutoForm`'s `fields`). This is how an app
   * attaches a domain widget to a field the generic form cannot render well —
   * a fare zone matrix, a colour picker, a code editor — without forking this
   * panel. Reach nested fields through `objectProps.controlProps`.
   *
   * @example
   * ```tsx
   * <AdminParameters
   *   fields={{
   *     "ticketing.fares.catalog": {
   *       payg: { objectProps: { controlProps: { zoneFareCents: { custom: ZoneMatrix } } } },
   *     },
   *   }}
   * />
   * ```
   */
  fields?: Record<string, Record<string, Partial<Omit<ControlProps, "input">>>>;
}

export function AdminParameters(props: AdminParametersProps = {}) {
  const client = useClient<AdminParameterController>();
  const { tr } = useI18n();
  const toast = useToast();
  const dialog = useDialog();
  // Selected parameter is bound to the URL (`?param=<name>`) via useQueryParams
  // in querystring mode (replaceState — picking a parameter does not add a
  // browser-history entry), mirroring the admin user-detail tab pattern.
  const [query, setQuery] = useQueryParams(parameterQuerySchema, {
    format: "querystring",
  });
  const selected = query.param || undefined;
  const setSelected = (name: string) => setQuery({ param: name });
  const [reloadKey, setReloadKey] = useState(0);

  const { data: treeNodes } = useQuery(
    { handler: () => client.getParameterTree() as Promise<ParamNode[]> },
    [client, reloadKey],
  );

  const leafNames = useMemo(
    () => collectLeafNames(treeNodes ?? []),
    [treeNodes],
  );

  const exportAll = useAction(
    {
      handler: async () => {
        if (leafNames.length === 0) return;
        const payload: Array<{ name: string; content: unknown }> = [];
        for (const name of leafNames) {
          const res = await client.getCurrent({ params: { name } });
          payload.push({
            name,
            content:
              res.current?.content ?? res.currentValue ?? res.defaultValue,
          });
        }
        downloadJson(payload, "parameters.json");
      },
    },
    [client, leafNames],
  );

  const importParams = useAction<[File], void>(
    {
      handler: async (file) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(await file.text());
        } catch {
          toast.error(
            tr("admin.parameters.importInvalidJson", {
              default: "Invalid JSON file",
            }),
          );
          return;
        }
        const items = Array.isArray(parsed) ? parsed : [parsed];
        const valid = items.filter(
          (it): it is { name: string; content: unknown } =>
            !!it &&
            typeof (it as any).name === "string" &&
            "content" in (it as any),
        );
        if (valid.length === 0) {
          toast.error(
            tr("admin.parameters.importNoItems", {
              default: "No parameters found in file",
            }),
          );
          return;
        }
        const known = new Set(leafNames);
        const recognized = valid.filter((it) => known.has(it.name));
        const skipped = valid.length - recognized.length;
        if (recognized.length === 0) {
          toast.error(
            tr("admin.parameters.importNoneMatch", {
              default: "No registered parameters match the imported names",
            }),
          );
          return;
        }
        const ok = await dialog.confirm({
          title: tr("admin.parameters.importTitle", {
            default: "Import parameters",
          }),
          description: tr("admin.parameters.importConfirm", {
            default: `Import ${recognized.length} parameter(s)? ${skipped > 0 ? `${skipped} unknown entrie(s) will be skipped.` : ""}`,
            args: [String(recognized.length), String(skipped)],
          }),
        });
        if (!ok) return;
        for (const it of recognized) {
          await client.createVersion({
            params: { name: it.name },
            body: {
              content: it.content as Record<string, any>,
              changeDescription: "Imported",
            },
          });
        }
        toast.success(
          tr("admin.parameters.imported", {
            default: `Imported ${recognized.length} parameter(s)`,
            args: [String(recognized.length)],
          }),
        );
        setReloadKey((k) => k + 1);
      },
    },
    [client, leafNames, dialog, toast, tr],
  );

  const rollback = useAction<[number], void>(
    {
      handler: async (version) => {
        if (!selected) return;
        const ok = await dialog.confirm({
          title: tr("admin.parameters.rollbackTitle", {
            default: "Roll back parameter",
          }),
          description: tr("admin.parameters.rollbackConfirm", {
            default: `Roll back to version ${version}? This creates a new version copying that content.`,
            args: [String(version)],
          }),
        });
        if (!ok) return;
        await client.rollback({
          params: { name: selected },
          body: { targetVersion: version },
        });
        toast.success(
          tr("admin.parameters.rolledBack", {
            default: "Parameter rolled back",
          }),
        );
        setReloadKey((k) => k + 1);
      },
    },
    [client, selected, dialog, toast, tr],
  );

  return (
    <div
      className={cn(
        "grid min-h-0 flex-1 p-6",
        // Desktop-first 3-pane (tree | editor | history). Columns narrow on
        // laptops (lg) and reach full width at xl; below lg the panes stack
        // into a single scrollable column. The history pane only appears once
        // a parameter is selected, so the grid drops a column until then.
        selected
          ? "grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_260px] xl:grid-cols-[280px_minmax(0,1fr)_300px]"
          : "grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]",
      )}
    >
      <ParameterTreePane
        nodes={treeNodes}
        selected={selected}
        onSelect={setSelected}
        onExportAll={exportAll.run}
        onImport={importParams.run}
        exporting={exportAll.loading}
        importing={importParams.loading}
      />
      <ParameterEditorPane
        key={selected ?? "none"}
        name={selected}
        fields={selected ? props.fields?.[selected] : undefined}
        reloadKey={reloadKey}
        onSaved={() => {
          setReloadKey((k) => k + 1);
          toast.success(
            tr("admin.parameters.saved", {
              default: "Parameter saved",
            }),
          );
        }}
      />
      {selected && (
        <ParameterHistoryPane
          key={`history-${selected}`}
          name={selected}
          reloadKey={reloadKey}
          onRollback={rollback.run}
        />
      )}
    </div>
  );
}

// ── Pane A: tree ─────────────────────────────────────────────────────

interface ParameterTreePaneProps {
  nodes: ParamNode[] | undefined;
  selected: string | undefined;
  onSelect: (name: string) => void;
  onExportAll: () => void | Promise<void>;
  onImport: (file: File) => void | Promise<void>;
  exporting?: boolean;
  importing?: boolean;
}

interface ParamNode {
  name: string;
  path: string;
  isLeaf: boolean;
  children: ParamNode[];
}

const ParameterTreePane = (props: ParameterTreePaneProps) => {
  const { tr } = useI18n();
  return (
    <div className="bg-card flex min-h-0 flex-col gap-2 rounded-l-lg border p-2">
      <div className="text-muted-foreground flex items-center gap-1.5 px-2 py-1 text-xs font-medium uppercase tracking-wide">
        <Settings2 className="size-3.5" />
        {tr("admin.parameters.treeTitle", { default: "Parameters" })}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-2">
        {!props.nodes ? (
          // Loading — distinct from an empty (loaded) tree.
          ["t1", "t2", "t3", "t4", "t5"].map((k, i) => (
            <div key={k} className="flex items-center gap-1.5 px-2 py-1.5">
              <Skeleton className="size-3.5 shrink-0 rounded" />
              <Skeleton
                className="h-3.5"
                style={{ width: `${[70, 55, 80, 50, 65][i]}%` }}
              />
            </div>
          ))
        ) : props.nodes.length ? (
          props.nodes.map((node) => (
            <TreeNodeView
              key={node.path}
              node={node}
              depth={0}
              selected={props.selected}
              onSelect={props.onSelect}
            />
          ))
        ) : (
          <span className="text-muted-foreground px-2 py-1 text-xs">
            {tr("admin.parameters.treeEmpty", {
              default: "No parameters registered.",
            })}
          </span>
        )}
      </div>
      <TreeFooterActions
        onExportAll={props.onExportAll}
        onImport={props.onImport}
        exporting={props.exporting}
        importing={props.importing}
        disabled={!props.nodes?.length}
      />
    </div>
  );
};

interface TreeFooterActionsProps {
  onExportAll: () => void | Promise<void>;
  onImport: (file: File) => void | Promise<void>;
  disabled?: boolean;
  exporting?: boolean;
  importing?: boolean;
}

const TreeFooterActions = (props: TreeFooterActionsProps) => {
  const { tr } = useI18n();
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center justify-center gap-2 border-t pt-2">
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          // Reset so the same file can be re-selected on a subsequent click.
          e.target.value = "";
          if (file) await props.onImport(file);
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={props.disabled || props.exporting}
        onClick={() => props.onExportAll()}
      >
        <Download className="size-3.5" />
        {tr("admin.parameters.export", { default: "Export" })}
      </Button>
      <span aria-hidden className="bg-border h-4 w-px rotate-12" />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={props.importing}
        onClick={() => fileInput.current?.click()}
      >
        <Upload className="size-3.5" />
        {tr("admin.parameters.import", { default: "Import" })}
      </Button>
    </div>
  );
};

interface TreeNodeViewProps {
  node: ParamNode;
  depth: number;
  selected: string | undefined;
  onSelect: (name: string) => void;
}

const TreeNodeView = (props: TreeNodeViewProps) => {
  const { node } = props;
  const { tr } = useI18n();
  const [open, setOpen] = useState(true);
  const isActive = node.isLeaf && props.selected === node.path;
  // Translatable label keyed by the full dotted path
  // (`parameters.courts.pricing`, `parameters.courts`), falling back to the
  // English title-case of the last segment when the app has no dictionary
  // entry — so a parameters tree always renders, localized or not.
  const label = tr(`parameters.${node.path}`, { default: labelOf(node.name) });
  const indent = props.depth * 12;

  if (node.isLeaf) {
    return (
      <button
        type="button"
        onClick={() => props.onSelect(node.path)}
        style={{ paddingLeft: 8 + indent }}
        className={cn(
          "hover:bg-accent flex items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm transition-colors",
          isActive && "bg-accent text-accent-foreground font-medium",
        )}
      >
        <FileCog className="size-3.5 shrink-0 opacity-60" />
        <span className="truncate">{label}</span>
      </button>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ paddingLeft: 4 + indent }}
        className="hover:bg-accent text-muted-foreground flex items-center gap-1 rounded-md py-1.5 pr-2 text-left text-xs font-medium transition-colors"
      >
        <ChevronRight
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
        />
        <span className="truncate">{label}</span>
      </button>
      {open &&
        node.children.map((child) => (
          <TreeNodeView
            key={child.path}
            node={child}
            depth={props.depth + 1}
            selected={props.selected}
            onSelect={props.onSelect}
          />
        ))}
    </>
  );
};

// ── Pane B: editor ───────────────────────────────────────────────────

interface ParameterEditorPaneProps {
  /** Per-field overrides for this parameter's generated form. */
  fields?: Record<string, Partial<Omit<ControlProps, "input">>>;
  name: string | undefined;
  reloadKey: number;
  onSaved: () => void;
}

const ParameterEditorPane = (props: ParameterEditorPaneProps) => {
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
          tr("admin.parameters.factoryReset", {
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
        <div className="flex items-center gap-3 border-b px-4 pb-3 pt-3">
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
      <ParameterEditorForm
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

interface ParameterEditorFormProps {
  /** Per-field overrides forwarded to AutoForm (domain widgets). */
  fields?: Record<string, Partial<Omit<ControlProps, "input">>>;
  /** `$parameter({ description })` as declared in code. */
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

const ParameterEditorForm = (props: ParameterEditorFormProps) => {
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
    () => tr(`parameters.${props.name}`, { default: labelOf(props.name) }),
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
    // Translate each ancestor folder by its cumulative path
    // (`parameters.courts`), falling back to the raw segment.
    return parts
      .map((segment, i) => {
        const path = parts.slice(0, i + 1).join(".");
        return tr(`parameters.${path}`, { default: segment });
      })
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
            variant: "outline",
            onClick: props.onFactoryReset,
            disabled: props.factoryResetLoading,
          },
          {
            label: tr("admin.parameters.export", { default: "Export" }),
            icon: "download",
            variant: "outline",
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

// ── Pane C: history ──────────────────────────────────────────────────

interface ParameterHistoryPaneProps {
  name: string | undefined;
  reloadKey: number;
  onRollback: (version: number) => Promise<void>;
}

const ParameterHistoryPane = (props: ParameterHistoryPaneProps) => {
  const client = useClient<AdminParameterController>();
  const { tr } = useI18n();

  const { data: history } = useQuery(
    {
      handler: () =>
        client.getHistory({
          params: { name: props.name! },
          query: { limit: 50 },
        }),
      enabled: !!props.name,
    },
    [client, props.name, props.reloadKey],
  );

  return (
    <div className="bg-card flex min-h-0 flex-col overflow-hidden rounded-r-lg border">
      <div className="text-muted-foreground flex items-center gap-1.5 px-3 py-2 text-xs font-medium uppercase tracking-wide">
        <HistoryIcon className="size-3.5" />
        {tr("admin.parameters.historyTitle", { default: "History" })}
      </div>
      {!props.name ? (
        <span className="text-muted-foreground px-3 py-2 text-xs">
          {tr("admin.parameters.historyHint", {
            default: "Select a parameter to see its versions.",
          })}
        </span>
      ) : !history ? (
        <div className="flex flex-col border-t">
          {["s1", "s2", "s3"].map((k) => (
            <div
              key={k}
              className="flex items-center gap-3 border-b px-3 py-2.5"
            >
              <Skeleton className="size-4 rounded-full" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
          ))}
        </div>
      ) : !history.versions.length ? (
        <span className="text-muted-foreground px-3 py-2 text-xs">
          {tr("admin.parameters.historyEmpty", {
            default: "No saved versions yet",
          })}
        </span>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border-t">
          {[...history.versions]
            // Most recent activation on top.
            .sort(
              (a, b) =>
                b.activationDate.localeCompare(a.activationDate) ||
                b.version - a.version,
            )
            .map((v) => (
              <ParameterHistoryItem
                key={v.id}
                version={v}
                onRollback={props.onRollback}
              />
            ))}
        </div>
      )}
    </div>
  );
};

// ── helpers ──────────────────────────────────────────────────────────

const collectLeafNames = (nodes: ParamNode[]): string[] => {
  const out: string[] = [];
  const walk = (n: ParamNode) => {
    if (n.isLeaf) out.push(n.path);
    for (const c of n.children) walk(c);
  };
  for (const n of nodes) walk(n);
  return out;
};

const downloadJson = (data: unknown, fileName: string) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser a moment to start the download before reclaiming the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
};

const labelOf = (s: string) => {
  const last = s.split(".").pop() ?? s;
  return last.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

export default AdminParameters;
