import * as React from "react";

void React;

import { z } from "alepha";
import type { AdminParameterController } from "alepha/api/parameters";
import { useAction, useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useQueryParams } from "alepha/react/router";
import { useMemo, useState } from "react";

import { PaneRail } from "../core/PaneRail.tsx";
import { useDialog } from "../core/useDialog.tsx";
import { useToast } from "../core/useToast.tsx";
import { cn } from "../core/utils.ts";
import type { ControlProps } from "../form/Control.tsx";
import { AdminParametersEditorPane } from "./AdminParametersEditorPane.tsx";
import { AdminParametersHistoryPane } from "./AdminParametersHistoryPane.tsx";
import {
  collectLeafNames,
  countOrphanLeaves,
  type ParamNode,
  pruneOrphans,
} from "./adminParametersTree.ts";
import { AdminParametersTreePane } from "./AdminParametersTreePane.tsx";
import { downloadJson } from "./downloadJson.ts";
import { useParameterHistoryCollapsed } from "./useParameterHistoryCollapsed.ts";

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
export const AdminParameters = (props: AdminParametersProps = {}) => {
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
  // Orphans (rows with no `$parameter` behind them) are hidden until asked
  // for: the tree is a list of live configuration, and an orphan is either a
  // leftover from a rename or a module this process did not load, which is
  // also why nothing here deletes one on its own.
  const [showOrphans, setShowOrphans] = useState(false);
  const [historyCollapsed, toggleHistory] = useParameterHistoryCollapsed();

  const { data: treeNodes } = useQuery(
    { handler: () => client.getParameterTree() as Promise<ParamNode[]> },
    [client, reloadKey],
  );

  const orphanCount = useMemo(
    () => countOrphanLeaves(treeNodes ?? []),
    [treeNodes],
  );
  const visibleNodes = useMemo(
    () =>
      treeNodes === undefined || showOrphans
        ? treeNodes
        : pruneOrphans(treeNodes),
    [treeNodes, showOrphans],
  );

  const deleteOrphan = async (name: string) => {
    const ok = await dialog.confirm({
      title: tr("admin.parameters.orphanDeleteTitle", {
        default: "Delete this parameter?",
      }),
      description: tr("admin.parameters.orphanDeleteDescription", {
        default: `No $parameter declares "${name}" in this process. If a module that is not loaded here still reads it, deleting it throws that configuration away. Every stored version of it is removed.`,
        args: [name],
      }),
      confirmLabel: tr("admin.parameters.orphanDelete", { default: "Delete" }),
      destructive: true,
    });
    if (!ok) return;
    try {
      await client.deleteParameter({ params: { name } });
      toast.success(
        tr("admin.parameters.orphanDeleted", {
          default: `"${name}" deleted.`,
          args: [name],
        }),
      );
      if (selected === name) setQuery({ param: undefined });
      setReloadKey((k) => k + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

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
        // a parameter is selected, so the grid drops a column until then, and
        // collapsed it is a 36px rail, so the form takes the rest.
        !selected
          ? "grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]"
          : historyCollapsed
            ? "grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_36px] xl:grid-cols-[280px_minmax(0,1fr)_36px]"
            : "grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_260px] xl:grid-cols-[280px_minmax(0,1fr)_300px]",
      )}
    >
      <AdminParametersTreePane
        nodes={visibleNodes}
        selected={selected}
        onSelect={setSelected}
        onExportAll={exportAll.run}
        onImport={importParams.run}
        exporting={exportAll.loading}
        importing={importParams.loading}
        orphanCount={orphanCount}
        showOrphans={showOrphans}
        onToggleOrphans={() => setShowOrphans((v) => !v)}
        onDeleteOrphan={deleteOrphan}
      />
      <AdminParametersEditorPane
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
      {selected &&
        historyCollapsed && (
          // The rail exists only where the pane is a column (lg and up). Below
          // that the panes stack, the history sits under the form and frees no
          // width by closing, so it stays open there whatever was stored.
          <PaneRail
            side="right"
            label={tr("admin.parameters.historyExpand", {
              default: "Show history",
            })}
            onExpand={toggleHistory}
            className="bg-card hidden rounded-r-lg border lg:flex"
          />
        )}
      {selected && (
        <AdminParametersHistoryPane
          key={`history-${selected}`}
          name={selected}
          reloadKey={reloadKey}
          onRollback={rollback.run}
          onCollapse={toggleHistory}
          className={historyCollapsed ? "lg:hidden" : undefined}
        />
      )}
    </div>
  );
};

const parameterQuerySchema = z.object({ param: z.string().optional() });

export default AdminParameters;
