import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  useDialog,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { useAction, useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { isHttpError } from "alepha/server";
import { Plus, Redo2, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";

import type { AutomationController } from "../../../../../../api/controllers/AutomationController.ts";
import type { AutomationCatalogNodeType } from "../../../../../../api/schemas/automationCatalogNodeTypeSchema.ts";
import type { automationCatalogSchema } from "../../../../../../api/schemas/automationCatalogSchema.ts";
import { automationEditorHeaderSchema } from "../../../../../../api/schemas/automationEditorHeaderSchema.ts";
import { AutomationGraph } from "../../../../../../api/schemas/AutomationGraph.ts";
import type { AutomationGraphEdge } from "../../../../../../api/schemas/automationGraphEdgeSchema.ts";
import type { AutomationResource } from "../../../../../../api/schemas/automationResourceSchema.ts";
import { AutomationVocabulary } from "../../../../../../api/schemas/AutomationVocabulary.ts";
import type { I18n } from "../../../../services/I18n.ts";
import AutomationCanvas from "./AutomationCanvas.tsx";
import {
  AutomationCanvasEdits,
  type AutomationWireRefusal,
} from "./AutomationCanvasEdits.ts";
import AutomationNodeInspector from "./AutomationNodeInspector.tsx";
import AutomationNodePalette, {
  type AutomationPaletteEntry,
} from "./AutomationNodePalette.tsx";
import { useAutomationDraft } from "./useAutomationDraft.ts";
import { useAutomationLeaveGuard } from "./useAutomationLeaveGuard.ts";

export interface AutomationGraphEditorProps {
  resource: AutomationResource;
  catalog: ReturnType<typeof automationCatalogSchema.parse>;
  onSaved: (resource: AutomationResource) => void;
  onClose: () => void;
  /**
   * The draft against what is saved: Run test tests what is saved.
   */
  onDirtyChange: (dirty: boolean) => void;
  /**
   * The source selected on the canvas, where Run test starts.
   */
  onSourceChange: (node: string | undefined) => void;
  /**
   * Discards the draft and reads the automation again, after a conflict.
   */
  onReload: () => void;
}

/**
 * The canvas as an editor (#Q3811). One draft per page, saved against the
 * revision it was opened at: a conflict keeps it and offers to discard it
 * and reload. The graph's own check runs on every change, each issue on its
 * node, and Save waits until none is left; the server's refusals land on
 * their node the same way. Every change is a step to undo or redo.
 */
const AutomationGraphEditor = (props: AutomationGraphEditorProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<AutomationController>();
  const dialog = useDialog();
  const draft = useAutomationDraft(props.resource.rule!);
  const [title, setTitle] = useState(props.resource.title);
  const [selected, setSelected] = useState<string>();
  const [adding, setAdding] = useState<{
    node?: string;
    port?: AutomationGraphEdge["port"];
  }>();
  const [server, setServer] = useState<{ node?: string; message: string }>();
  const [conflict, setConflict] = useState(false);
  const edits = new AutomationCanvasEdits();
  const graphs = new AutomationGraph();
  const graph = draft.graph;
  const catalog = props.catalog;
  const dirty = draft.dirty || title !== props.resource.title;
  useAutomationLeaveGuard(dirty);
  useEffect(() => props.onDirtyChange(dirty), [dirty, props.onDirtyChange]);
  const node = graph.nodes.find((item) => item.id === selected);
  useEffect(
    () => props.onSourceChange(node?.kind === "source" ? node.id : undefined),
    [node?.id, node?.kind, props.onSourceChange],
  );

  const found = graphs.check(graph, catalog.entries);
  const issues: Record<string, string[]> = {};
  const general: string[] = [];
  for (const issue of found)
    if (issue.node) (issues[issue.node] ??= []).push(issue.message);
    else general.push(issue.message);
  if (server?.node && graph.nodes.some((item) => item.id === server.node))
    (issues[server.node] ??= []).push(server.message);
  else if (server) general.push(server.message);

  const reasons: Record<AutomationWireRefusal, string> = {
    self: tr("automation.canvas.refuse.self"),
    duplicate: tr("automation.canvas.refuse.duplicate"),
    port: tr("automation.canvas.refuse.port"),
    intoSource: tr("automation.canvas.refuse.intoSource"),
    readAfterEvent: tr("automation.canvas.refuse.readAfterEvent"),
    readOneWay: tr("automation.canvas.refuse.readOneWay"),
    scheduleToRead: tr("automation.canvas.refuse.scheduleToRead"),
    scheduleOneRead: tr("automation.canvas.refuse.scheduleOneRead"),
    conditionAfterAction: tr("automation.canvas.refuse.conditionAfterAction"),
    cycle: tr("automation.canvas.refuse.cycle"),
    actions: tr("automation.canvas.refuse.actions", {
      args: [String(AutomationGraph.MAX_ACTIONS_PER_SOURCE)],
    }),
  };
  const refuse = (edge: AutomationGraphEdge) => {
    const reason = edits.refuse(graph, edge);
    return reason ? reasons[reason] : undefined;
  };
  const changed = () => setServer(undefined);

  /**
   * Why a node of this type cannot be added here, or nothing.
   */
  const unavailable = (nodeType: AutomationCatalogNodeType) => {
    if (!nodeType.available)
      return nodeType.reason ?? tr("automation.canvas.unavailable");
    if (graph.nodes.length >= AutomationGraph.MAX_NODES)
      return tr("automation.canvas.unavailable.nodes", {
        args: [String(AutomationGraph.MAX_NODES)],
      });
    if (nodeType.kind !== "source") return undefined;
    const sources = graphs.sources(graph);
    if (sources.length >= AutomationGraph.MAX_SOURCES)
      return tr("automation.canvas.unavailable.sources", {
        args: [String(AutomationGraph.MAX_SOURCES)],
      });
    if (
      sources.length > 0 &&
      (nodeType.type === AutomationVocabulary.SCHEDULE ||
        sources.some((item) => item.type === AutomationVocabulary.SCHEDULE))
    )
      return tr("automation.canvas.unavailable.schedule");
    return undefined;
  };
  const palette: AutomationPaletteEntry[] = (
    adding?.node
      ? edits.followers(
          graph,
          adding.node,
          adding.port ?? "out",
          catalog.nodeTypes,
        )
      : catalog.nodeTypes.filter((item) => item.kind !== "transform")
  ).map((nodeType) => ({ nodeType, reason: unavailable(nodeType) }));

  const add = (nodeType: AutomationCatalogNodeType) => {
    const from = adding?.node
      ? { node: adding.node, port: adding.port ?? ("out" as const) }
      : undefined;
    const result = edits.add(graph, nodeType, from);
    draft.change(() => result.graph);
    setSelected(result.id);
    setAdding(undefined);
    changed();
  };
  const remove = (removed: { nodes?: string[]; edges?: string[] }) => {
    draft.change((current) => edits.remove(current, removed));
    if (selected && removed.nodes?.includes(selected)) setSelected(undefined);
    changed();
  };

  const header = useForm({
    schema: automationEditorHeaderSchema,
    handler: () => undefined,
    initialValues: { title: props.resource.title },
    onChange: (name, value) => {
      if (name === "title") setTitle(String(value ?? ""));
    },
  });
  const save = useAction<[], boolean>(
    {
      handler: async () => {
        try {
          const saved = await api.updateAutomation({
            params: {
              projectId: props.resource.projectId,
              id: props.resource.id,
            },
            body: {
              title: title.trim(),
              rule: graph,
              expectedRevision: props.resource.revision,
            },
          });
          draft.reset(saved.rule ?? graph);
          setServer(undefined);
          props.onSaved(saved);
          return true;
        } catch (error) {
          // A conflict keeps the draft and offers the reload; a refusal
          // lands on the node it names, the draft kept as drawn.
          if (isHttpError(error, 409)) setConflict(true);
          else if (error instanceof Error) {
            const named = /^(?:node|source) '([^']+)': ([\s\S]*)$/.exec(
              error.message,
            );
            setServer(
              named
                ? { node: named[1], message: named[2] }
                : { message: error.message },
            );
          }
          throw error;
        }
      },
      // The refusal is shown on its node, or above the canvas.
      onError: () => {},
    },
    [api, props.resource, graph, title, props.onSaved],
  );
  const close = async () => {
    if (
      dirty &&
      !(await dialog.confirm({
        title: tr("automation.canvas.leave.title"),
        description: tr("automation.canvas.leave.description"),
        confirmLabel: tr("automation.canvas.leave.confirm"),
        destructive: true,
      }))
    )
      return;
    props.onClose();
  };
  // Undo and redo from the keyboard while the editor is open, outside a
  // field, which keeps its own.
  const history = { undo: draft.undo, redo: draft.redo };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest?.(
          "input, textarea, select, [contenteditable=true], [role=dialog]",
        ) ||
        !(event.ctrlKey || event.metaKey)
      )
        return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        history.undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        history.redo();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [history.undo, history.redo]);
  const blocked = found.length > 0 || !title.trim();

  return (
    <section
      className="flex flex-col gap-4"
      aria-label={tr("automation.canvas.editor")}
      data-testid="automation-graph-editor"
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-60 flex-1">
          <Control
            input={header.input.title}
            label={tr("automation.column.name")}
            disabled={save.loading}
          />
        </div>
        <Button
          variant="outlined"
          disabled={save.loading}
          data-testid="automation-canvas-add"
          onClick={() => setAdding({})}
        >
          <Plus className="size-4" />
          {tr("automation.canvas.add")}
        </Button>
        <Button
          variant="outlined"
          size="icon"
          aria-label={tr("automation.canvas.undo")}
          title={tr("automation.canvas.undo")}
          disabled={!draft.canUndo || save.loading}
          onClick={draft.undo}
        >
          <Undo2 className="size-4" />
        </Button>
        <Button
          variant="outlined"
          size="icon"
          aria-label={tr("automation.canvas.redo")}
          title={tr("automation.canvas.redo")}
          disabled={!draft.canRedo || save.loading}
          onClick={draft.redo}
        >
          <Redo2 className="size-4" />
        </Button>
        <Button
          variant="minimal"
          disabled={save.loading}
          onClick={() => void close()}
        >
          {tr("automation.setup.cancel")}
        </Button>
        <Button
          loading={save.loading}
          disabled={save.loading || blocked || !dirty}
          data-testid="automation-canvas-save"
          onClick={() => void save.run()}
        >
          {tr("automation.editor.save")}
        </Button>
      </div>
      {conflict && (
        <Alert data-testid="automation-canvas-conflict">
          <AlertTitle>{tr("automation.editor.conflictTitle")}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>{tr("automation.editor.conflict")}</span>
            <Button
              variant="outlined"
              intent="danger"
              onClick={() => {
                setConflict(false);
                props.onReload();
              }}
            >
              {tr("automation.editor.reload")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {general.length > 0 && (
        <ul
          role="alert"
          className="text-danger-text flex flex-col gap-1 text-sm"
          data-testid="automation-canvas-issues"
        >
          {general.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <AutomationCanvas
            graph={graph}
            sources={props.resource.sources}
            selected={selected}
            onSelect={setSelected}
            editing={{
              issues,
              refuse,
              onConnect: (edge) => {
                draft.change((current) => edits.connect(current, edge));
                changed();
              },
              onMove: (positions) =>
                draft.change((current) => edits.move(current, positions), {
                  record: false,
                }),
              onDragStart: draft.checkpoint,
              onDelete: remove,
              onAdd: (from, port) => setAdding({ node: from, port }),
            }}
          />
        </div>
        {node && (
          <AutomationNodeInspector
            key={node.id}
            graph={graph}
            node={node}
            catalog={catalog}
            issues={issues[node.id] ?? []}
            onChange={(change) => {
              draft.change((current) => edits.update(current, node.id, change));
              changed();
            }}
            onRetype={(nodeType) => {
              draft.change((current) =>
                edits.retype(current, node.id, nodeType),
              );
              changed();
            }}
            onRemove={() => remove({ nodes: [node.id] })}
            refuse={refuse}
            onConnect={(edge) => {
              draft.change((current) => edits.connect(current, edge));
              changed();
            }}
            onRemoveEdge={(edge) => remove({ edges: [edits.edgeId(edge)] })}
          />
        )}
      </div>
      <AutomationNodePalette
        open={!!adding}
        after={adding?.node}
        entries={palette}
        onPick={add}
        onClose={() => setAdding(undefined)}
      />
    </section>
  );
};

export default AutomationGraphEditor;
