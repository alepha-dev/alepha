import * as React from "react";

void React;

import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { cn } from "@alepha/ui/lib/utils";
import { jsonSchemaToTypeBox, type TObject } from "alepha";
import type { AdminParameterController } from "alepha/api/parameters";
import { useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import {
  ChevronRight,
  Clock,
  Download,
  FileCog,
  History as HistoryIcon,
  RotateCcw,
  Settings2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Three-pane admin parameters editor:
 *
 *   [ tree ][   AutoForm on current version   ][ history ]
 *
 * - Left:   collapsible tree of every registered parameter name. Dot-notation
 *           (`lore.campaign.limits`) becomes a folder hierarchy. Leaves are
 *           clickable; clicking sets the active parameter.
 * - Center: AutoForm bound to the parameter's runtime schema and pre-filled
 *           with the current effective value. Save creates a new immediate
 *           version through `createVersion`.
 * - Right:  reverse-chronological history. Each row can preview by loading
 *           its content into the form, or roll back the parameter to that
 *           version. The current version is badged.
 */
export function AdminParameters() {
  const client = useClient<AdminParameterController>();
  const { l, tr } = useI18n();
  const dialog = useDialog();
  const [selected, setSelected] = useState<string | undefined>();
  const [reloadKey, setReloadKey] = useState(0);

  const [treeNodes, setTreeNodes] = useState<ParamNode[] | undefined>();
  useEffect(() => {
    let cancelled = false;
    client.getParameterTree().then((nodes) => {
      if (!cancelled) setTreeNodes(nodes as ParamNode[]);
    });
    return () => {
      cancelled = true;
    };
  }, [client, reloadKey]);

  const leafNames = useMemo(
    () => collectLeafNames(treeNodes ?? []),
    [treeNodes],
  );

  const onExportAll = async () => {
    if (leafNames.length === 0) return;
    const payload: Array<{ name: string; content: unknown }> = [];
    for (const name of leafNames) {
      const res = await client.getCurrent({ params: { name } });
      payload.push({
        name,
        content: res.current?.content ?? res.currentValue ?? res.defaultValue,
      });
    }
    downloadJson(payload, "parameters.json");
  };

  const onImport = async (file: File) => {
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
          schemaHash: "",
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
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_340px] p-6">
      <ParameterTreePane
        nodes={treeNodes}
        selected={selected}
        onSelect={setSelected}
        onExportAll={onExportAll}
        onImport={onImport}
      />
      <ParameterEditorPane
        key={selected ?? "none"}
        name={selected}
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
      <ParameterHistoryPane
        name={selected}
        reloadKey={reloadKey}
        onRollback={async (version) => {
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
        }}
      />
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
        {props.nodes?.length ? (
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
        disabled={!props.nodes?.length}
      />
    </div>
  );
};

interface TreeFooterActionsProps {
  onExportAll: () => void | Promise<void>;
  onImport: (file: File) => void | Promise<void>;
  disabled?: boolean;
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
        disabled={props.disabled}
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
  const [open, setOpen] = useState(true);
  const isActive = node.isLeaf && props.selected === node.path;
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
        <span className="truncate">{labelOf(node.name)}</span>
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
        <span className="truncate">{labelOf(node.path)}</span>
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
  name: string | undefined;
  reloadKey: number;
  onSaved: () => void;
}

const ParameterEditorPane = (props: ParameterEditorPaneProps) => {
  const client = useClient<AdminParameterController>();
  const { tr } = useI18n();

  const [current, setCurrent] = useState<
    Awaited<ReturnType<AdminParameterController["getCurrent"]>> | undefined
  >();
  useEffect(() => {
    if (!props.name) {
      setCurrent(undefined);
      return;
    }
    let cancelled = false;
    setCurrent(undefined);
    client.getCurrent({ params: { name: props.name } }).then((res) => {
      if (!cancelled) setCurrent(res);
    });
    return () => {
      cancelled = true;
    };
  }, [client, props.name, props.reloadKey]);

  if (!props.name) {
    return (
      <div className="bg-card text-muted-foreground flex flex-1 items-center justify-center border-y text-sm">
        {tr("admin.parameters.emptySelection", {
          default: "Pick a parameter on the left to edit it.",
        })}
      </div>
    );
  }
  if (!current) {
    return (
      <div className="bg-card text-muted-foreground flex flex-1 items-center justify-center border-y text-sm">
        {tr("admin.parameters.loading", { default: "Loading…" })}
      </div>
    );
  }

  const data = current;
  const schema = data.schema
    ? (jsonSchemaToTypeBox(data.schema as any) as TObject)
    : (jsonSchemaToTypeBox({
        type: "object",
        properties: {},
      }) as TObject);
  const initial =
    (data.current?.content as Record<string, unknown> | undefined) ??
    (data.currentValue as Record<string, unknown> | undefined) ??
    (data.defaultValue as Record<string, unknown> | undefined) ??
    {};

  const schemaHash = data.current?.schemaHash ?? "";
  const defaultValue = (data.defaultValue ?? {}) as Record<string, any>;
  const exportContent =
    data.current?.content ?? data.currentValue ?? data.defaultValue ?? {};

  return (
    <ParameterEditorForm
      name={props.name}
      schema={schema}
      initial={initial}
      schemaHash={data.current?.schemaHash}
      currentVersion={data.current?.version}
      onSubmit={async (content) => {
        await client.createVersion({
          params: { name: props.name! },
          body: {
            content: content as Record<string, any>,
            schemaHash,
          },
        });
        props.onSaved();
      }}
      onFactoryReset={async () => {
        await client.createVersion({
          params: { name: props.name! },
          body: {
            content: defaultValue,
            schemaHash,
            changeDescription: "Factory reset to compiled defaults",
          },
        });
        toast.success(
          tr("admin.parameters.factoryReset", {
            default: "Parameter reset to defaults",
          }),
        );
        props.onSaved();
      }}
      onExport={() => {
        downloadJson(
          [{ name: props.name!, content: exportContent }],
          `${props.name}.json`,
        );
      }}
    />
  );
};

interface ParameterEditorFormProps {
  name: string;
  schema: TObject;
  initial: Record<string, unknown>;
  schemaHash?: string;
  currentVersion?: number;
  onSubmit: (content: unknown) => Promise<void>;
  onFactoryReset: () => Promise<void>;
  onExport: () => void;
}

const ParameterEditorForm = (props: ParameterEditorFormProps) => {
  const { tr } = useI18n();
  const form = useForm(
    {
      schema: props.schema,
      initialValues: props.initial as Record<string, any>,
      handler: async (values) => {
        await props.onSubmit(values);
      },
    },
    [props.name, props.schemaHash],
  );
  const title = useMemo(() => labelOf(props.name), [props.name]);
  const breadcrumb = useMemo(() => {
    const parts = props.name.split(".");
    parts.pop();
    return parts.join(" / ");
  }, [props.name]);

  return (
    <div className="bg-card flex min-h-0 flex-col overflow-hidden border-y">
      <div className="flex items-start justify-between border-b p-4">
        <div className="flex flex-col gap-0.5">
          {breadcrumb && (
            <span className="text-muted-foreground text-xs">{breadcrumb}</span>
          )}
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        {props.currentVersion != null && (
          <Badge variant="secondary">v{props.currentVersion}</Badge>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="p-4">
          <AutoForm
            form={form}
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
              },
              {
                label: tr("admin.parameters.export", { default: "Export" }),
                icon: "download",
                variant: "outline",
                onClick: props.onExport,
              },
            ]}
          />
        </div>
      </div>
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
  const { l, tr } = useI18n();

  const [history, setHistory] = useState<
    Awaited<ReturnType<AdminParameterController["getHistory"]>> | undefined
  >();
  useEffect(() => {
    if (!props.name) {
      setHistory(undefined);
      return;
    }
    let cancelled = false;
    setHistory(undefined);
    client
      .getHistory({ params: { name: props.name }, query: { limit: 50 } })
      .then((res) => {
        if (!cancelled) setHistory(res);
      });
    return () => {
      cancelled = true;
    };
  }, [client, props.name, props.reloadKey]);

  return (
    <div className="bg-card flex min-h-0 flex-col gap-2 rounded-r-lg border p-2">
      <div className="text-muted-foreground flex items-center gap-1.5 px-2 py-1 text-xs font-medium uppercase tracking-wide">
        <HistoryIcon className="size-3.5" />
        {tr("admin.parameters.historyTitle", { default: "History" })}
      </div>
      {!props.name ? (
        <span className="text-muted-foreground px-2 py-1 text-xs">
          {tr("admin.parameters.historyHint", {
            default: "Select a parameter to see its versions.",
          })}
        </span>
      ) : !history ? (
        <span className="text-muted-foreground px-2 py-1 text-xs">
          {tr("admin.parameters.loading", { default: "Loading…" })}
        </span>
      ) : !history.versions.length ? (
        <span className="text-muted-foreground px-2 py-1 text-xs">
          {tr("admin.parameters.historyEmpty", {
            default: "No saved versions yet",
          })}
        </span>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-2">
          {history.versions.map((v) => (
            <li
              key={v.id}
              className={cn(
                "rounded-md border p-2 text-xs",
                v.status === "current" && "border-primary/40 bg-primary/5",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-medium">v{v.version}</span>
                  <Badge
                    variant={
                      v.status === "current"
                        ? "default"
                        : v.status === "next" || v.status === "future"
                          ? "secondary"
                          : "outline"
                    }
                    className="text-[10px] uppercase"
                  >
                    {v.status}
                  </Badge>
                </div>
                {v.status !== "current" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => props.onRollback(v.version)}
                  >
                    <RotateCcw className="size-3" />
                    {tr("admin.parameters.rollback", { default: "Rollback" })}
                  </Button>
                )}
              </div>
              <div className="text-muted-foreground mt-1 flex items-center gap-1">
                <Clock className="size-3" />
                <span>{String(l(v.activationDate, { date: "fromNow" }))}</span>
              </div>
              {v.changeDescription && (
                <p className="text-muted-foreground mt-1 line-clamp-2 leading-snug">
                  {v.changeDescription}
                </p>
              )}
              {v.creatorName && (
                <p className="text-muted-foreground mt-1 truncate text-[11px]">
                  {v.creatorName}
                </p>
              )}
            </li>
          ))}
        </ul>
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
