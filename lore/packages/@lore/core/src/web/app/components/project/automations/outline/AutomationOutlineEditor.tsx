import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  useDialog,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { useAction, useClient, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { isHttpError } from "alepha/server";
import { Play, Redo2, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";

import type { AutomationController } from "../../../../../../api/controllers/AutomationController.ts";
import type { AutomationCatalogNodeType } from "../../../../../../api/schemas/automationCatalogNodeTypeSchema.ts";
import type { automationCatalogPresetSchema } from "../../../../../../api/schemas/automationCatalogPresetSchema.ts";
import type { automationCatalogSchema } from "../../../../../../api/schemas/automationCatalogSchema.ts";
import { automationEditorHeaderSchema } from "../../../../../../api/schemas/automationEditorHeaderSchema.ts";
import type { AutomationFilterValue } from "../../../../../../api/schemas/automationFilterValueSchema.ts";
import { AutomationGraph } from "../../../../../../api/schemas/AutomationGraph.ts";
import type { AutomationGraphValue } from "../../../../../../api/schemas/automationGraphSchema.ts";
import { AutomationOutline } from "../../../../../../api/schemas/AutomationOutline.ts";
import type { AutomationResource } from "../../../../../../api/schemas/automationResourceSchema.ts";
import type { AutomationVariableApproval } from "../../../../../../api/schemas/automationVariableApprovalSchema.ts";
import { currentProjectAtom } from "../../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../../services/I18n.ts";
import AutomationPresetSetup from "../AutomationPresetSetup.tsx";
import { useAutomationDraft } from "../canvas/useAutomationDraft.ts";
import { useAutomationLeaveGuard } from "../canvas/useAutomationLeaveGuard.ts";
import { useAutomationLabels } from "../useAutomationLabels.ts";
import AutomationOutlineAside, {
  type AutomationOutlineCheck,
} from "./AutomationOutlineAside.tsx";
import AutomationOutlineBlockEditor from "./AutomationOutlineBlockEditor.tsx";
import AutomationOutlineEventMenu from "./AutomationOutlineEventMenu.tsx";
import { AutomationOutlineTones } from "./AutomationOutlineTones.ts";
import { useAutomationOutlineNames } from "./useAutomationOutlineNames.ts";
import { useAutomationOutlineWords } from "./useAutomationOutlineWords.ts";

type AutomationCatalogPreset = ReturnType<
  typeof automationCatalogPresetSchema.parse
>;

export interface AutomationOutlineEditorProps {
  /**
   * The automation edited; absent, a new one, created disabled by its
   * first save.
   */
  resource?: AutomationResource;
  /**
   * A new automation's starting point: a preset's graph, or nothing.
   */
  initial?: { title: string; rule: AutomationGraphValue };
  catalog: ReturnType<typeof automationCatalogSchema.parse>;
  onSaved: (resource: AutomationResource) => void;
  onClose: () => void;
  /**
   * The draft against what is saved: Test tests what is saved.
   */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * The event of the row open, where Test starts.
   */
  onSourceChange?: (node: string | undefined) => void;
  /**
   * Discards the draft and reads the automation again, after a conflict.
   */
  onReload?: () => void;
  /**
   * Takes the reader to the test, below the editor; absent, no Test.
   */
  onTest?: () => void;
}

/**
 * The outline as the editor (#Q3848): one draft per page, the graph, held
 * by `useAutomationDraft` with its undo and redo, saved against the
 * revision it was opened at; a conflict keeps it and offers to discard it
 * and reload. Every change is an edit of `AutomationOutline`, a row opens
 * in place into its form, and a refusal lands on the row it names.
 */
const AutomationOutlineEditor = (props: AutomationOutlineEditorProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<AutomationController>();
  const dialog = useDialog();
  const [project] = useStore(currentProjectAtom);
  const resource = props.resource;
  const draft = useAutomationDraft(
    resource?.rule ?? props.initial?.rule ?? AutomationOutline.EMPTY,
    { saved: !!resource },
  );
  const savedTitle = resource?.title ?? "";
  const [title, setTitle] = useState(
    resource?.title ?? props.initial?.title ?? "",
  );
  const [open, setOpen] = useState<string>();
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const [merging, setMerging] = useState<AutomationCatalogPreset>();
  const [server, setServer] = useState<{ message: string }>();
  const [conflict, setConflict] = useState(false);
  const labels = useAutomationLabels();
  const sentences = useAutomationOutlineWords();
  const outline = new AutomationOutline();
  const graphs = new AutomationGraph();
  const graph = draft.graph;
  const catalog = props.catalog;
  const names = useAutomationOutlineNames(graph);
  const dirty = draft.dirty || title !== savedTitle;
  useAutomationLeaveGuard(dirty);
  useEffect(() => props.onDirtyChange?.(dirty), [dirty, props.onDirtyChange]);
  const openNode = graph.nodes.find((item) => item.id === open);
  useEffect(
    () =>
      props.onSourceChange?.(
        openNode?.kind === "source" ? openNode.id : undefined,
      ),
    [openNode?.id, openNode?.kind, props.onSourceChange],
  );

  const reading = outline.read(graph);
  const blocks = reading.outline ? reading.blocks : [];
  // An empty draft is a start, not an error: nothing is checked until the
  // first choice (#Q3849). "Before you save" reads two sources, both in the
  // browser: the graph's own check, and each node's required fields left
  // empty. What only the server knows comes back at Save.
  const empty = graph.nodes.length === 0;
  const unfilled = empty
    ? []
    : outline.unfilled(
        graph,
        catalog.nodeTypes,
        catalog.channels
          .filter((item) => !item.addressable)
          .map((item) => item.key),
      );
  const filling = new Set(unfilled.map((item) => item.node));
  const label = (id: string) => {
    const node = graphs.node(graph, id);
    if (!node) return id;
    if (node.kind === "source") return labels.source(node);
    if (node.kind === "condition") return tr("automation.outline.onlyIf");
    if (node.kind === "read")
      return tr(`automation.source.${node.type}`, { default: node.type });
    return tr(`automation.action.${node.type}`, { default: node.type });
  };
  const field = (slot: string) =>
    slot === "field"
      ? tr("automation.outline.check.field")
      : slot === "value"
        ? tr("automation.outline.check.value")
        : tr(`automation.setup.${slot}`, { default: slot });
  // A message as a person reads it: no node id in front of it.
  const bare = (message: string, node?: string) => {
    let text = message
      .replace(/^nodes\.\d+: /, "")
      .replace(/^(?:node|source) '[^']+': /, "");
    if (node && (text.startsWith(`${node}.`) || text.startsWith(`${node}[`)))
      text = text
        .slice(node.length)
        .replace(/^\[[^\]]*\]/, "")
        .replace(
          /^\.([A-Za-z]+): /,
          (_match, slot: string) => `${field(slot)}: `,
        );
    return text;
  };
  const line = (
    node: string | undefined,
    text: string,
    tone: AutomationOutlineCheck["tone"],
  ): AutomationOutlineCheck => ({
    node,
    text: node ? `${label(node)}: ${text}` : text,
    short: text,
    tone,
  });
  const position = new Map(
    blocks
      .flatMap((block) => outline.members(block))
      .map((node, index) => [node.id, index] as const),
  );
  const checks: AutomationOutlineCheck[] = [];
  const found = empty ? [] : graphs.check(graph, catalog.entries);
  for (const issue of found) {
    const node = outline.nodeOf(graph, issue);
    // A field left empty is said once, as To fill.
    if (node && filling.has(node)) continue;
    checks.push(line(node, bare(issue.message, node), "warning"));
  }
  for (const node of filling)
    checks.push(
      line(
        node,
        tr("automation.outline.check.toFill", {
          args: [
            unfilled
              .filter((item) => item.node === node)
              .map((item) => field(item.slot))
              .join(", "),
          ],
        }),
        "warning",
      ),
    );
  if (!empty && !title.trim())
    checks.push(
      line(undefined, tr("automation.outline.check.name"), "warning"),
    );
  if (server) {
    const node = outline.nodeOf(graph, server);
    checks.push(line(node, bare(server.message, node), "danger"));
  }
  // An issue naming no node first, then each row in the outline's order.
  checks.sort(
    (left, right) =>
      (left.node ? (position.get(left.node) ?? 0) + 1 : 0) -
      (right.node ? (position.get(right.node) ?? 0) + 1 : 0),
  );
  const issues: Record<string, AutomationOutlineCheck[]> = {};
  for (const check of checks)
    if (check.node) (issues[check.node] ??= []).push(check);
  const words = sentences(blocks);
  // A line opens its row and scrolls to it, once it is drawn; a read's line
  // opens its schedule's row.
  const reveal = (node: string) => {
    const block = blocks.find((item) => item.read?.id === node);
    const target = block ? block.events[0].id : node;
    setOpen(target);
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-testid="automation-outline-row-${target}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  };

  const changed = () => setServer(undefined);
  const change = (
    edit: (current: AutomationGraphValue) => AutomationGraphValue,
  ) => {
    draft.change(edit);
    changed();
  };
  const add = (
    edit: (current: AutomationGraphValue) => {
      graph: AutomationGraphValue;
      id: string;
    },
  ) => {
    const result = edit(graph);
    draft.change(() => result.graph);
    setOpen(result.id);
    changed();
  };
  const schedule = graphs
    .sources(graph)
    .some((node) => node.type === "schedule");
  const sources = graphs.sources(graph);
  const starts = catalog.nodeTypes
    .filter((item) => item.kind === "source")
    .map((nodeType) => ({
      nodeType,
      reason: !nodeType.available
        ? (nodeType.reason ?? tr("automation.outline.unavailable"))
        : sources.length >= AutomationGraph.MAX_SOURCES
          ? tr("automation.outline.unavailable.sources", {
              args: [String(AutomationGraph.MAX_SOURCES)],
            })
          : nodeType.type === "schedule" && sources.length > 0
            ? tr("automation.outline.unavailable.schedule")
            : undefined,
    }));
  const presets = catalog.presets.map((preset) => ({
    preset,
    reason: !preset.available
      ? (preset.reason ?? tr("automation.outline.unavailable"))
      : sources.length > 0 && (!!preset.schedule || schedule)
        ? tr("automation.outline.unavailable.schedule")
        : sources.length >= AutomationGraph.MAX_SOURCES
          ? tr("automation.outline.unavailable.sources", {
              args: [String(AutomationGraph.MAX_SOURCES)],
            })
          : undefined,
  }));
  const addBlock = (nodeType: AutomationCatalogNodeType) => {
    const read =
      nodeType.type === "schedule"
        ? catalog.nodeTypes.find(
            (item) => item.kind === "read" && item.available,
          )
        : undefined;
    add((current) =>
      outline.addBlock(
        current,
        { type: nodeType.type, config: outline.config(nodeType) },
        read ? { type: read.type, config: outline.config(read) } : undefined,
      ),
    );
  };
  const merge = async (
    preset: AutomationCatalogPreset,
    values: Record<string, AutomationFilterValue>,
    bindings: Record<string, AutomationVariableApproval>,
  ) => {
    const prefix = outline.prefix(graph, preset.key);
    const built = await api.draftAutomationFromPreset({
      params: { projectId: project!.id },
      body: { key: preset.key, values, bindings, prefix },
    });
    // A preset arrives as one block, without where the canvas drew it.
    const rule: AutomationGraphValue = {
      ...built.rule,
      nodes: built.rule.nodes.map(({ position: _position, ...node }) => node),
    };
    draft.change((current) => outline.merge(current, rule));
    if (!title.trim()) {
      setTitle(built.title);
      header.input.title.set(built.title);
    }
    setMerging(undefined);
    changed();
  };

  const header = useForm({
    schema: automationEditorHeaderSchema,
    handler: () => undefined,
    initialValues: { title: resource?.title ?? props.initial?.title ?? "" },
    onChange: (name, value) => {
      if (name === "title") setTitle(String(value ?? ""));
    },
  });
  const save = useAction<[], boolean>(
    {
      handler: async () => {
        // The outline places nothing: a graph is saved without positions,
        // and the server lays it out until positions leave it (#Q3852).
        const rule: AutomationGraphValue = {
          ...graph,
          nodes: graph.nodes.map(({ position: _position, ...node }) => node),
        };
        try {
          const saved = resource
            ? await api.updateAutomation({
                params: { projectId: resource.projectId, id: resource.id },
                body: {
                  title: title.trim(),
                  rule,
                  expectedRevision: resource.revision,
                },
              })
            : // The first save creates it, disabled (#Q3812).
              await api.createAutomation({
                params: { projectId: project!.id },
                body: { title: title.trim(), rule },
              });
          draft.reset(saved.rule ?? graph);
          setServer(undefined);
          props.onSaved(saved);
          return true;
        } catch (error) {
          // A conflict keeps the draft and offers the reload; a refusal
          // lands on the row it names, the draft kept as it is.
          if (isHttpError(error, 409)) setConflict(true);
          else if (error instanceof Error) {
            setServer({ message: error.message });
            const node = outline.nodeOf(graph, { message: error.message });
            if (node) reveal(node);
          }
          throw error;
        }
      },
      // The refusal is shown on its row, or above the blocks.
      onError: () => {},
    },
    [api, resource, project?.id, graph, title, props.onSaved],
  );
  const close = async () => {
    if (
      dirty &&
      !(await dialog.confirm({
        title: tr("automation.outline.leave.title"),
        description: tr("automation.outline.leave.description"),
        confirmLabel: tr("automation.outline.leave.confirm"),
        destructive: true,
      }))
    )
      return;
    props.onClose();
  };
  // Undo and redo from the keyboard outside a field, which keeps its own.
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
  const blocked = empty || checks.length > 0;
  const several = blocks.length > 1;
  // The block holding the open row unfolds, so a refusal is seen.
  const holding = open
    ? blocks.find((block) =>
        outline.members(block).some((node) => node.id === open),
      )?.key
    : undefined;

  return (
    <section
      className="flex flex-col gap-4"
      aria-label={tr("automation.outline.editor")}
      data-testid="automation-outline-editor"
    >
      <div className="bg-card sticky top-0 z-10 -mx-1 flex flex-wrap items-end gap-2 rounded-lg border px-3 py-2 shadow-sm">
        <div className="min-w-48 flex-1">
          <Control
            input={header.input.title}
            label={tr("automation.column.name")}
            disabled={save.loading}
          />
        </div>
        <Button
          variant="outlined"
          size="icon"
          aria-label={tr("automation.outline.undo")}
          title={tr("automation.outline.undo")}
          disabled={!draft.canUndo || save.loading}
          onClick={draft.undo}
        >
          <Undo2 className="size-4" />
        </Button>
        <Button
          variant="outlined"
          size="icon"
          aria-label={tr("automation.outline.redo")}
          title={tr("automation.outline.redo")}
          disabled={!draft.canRedo || save.loading}
          onClick={draft.redo}
        >
          <Redo2 className="size-4" />
        </Button>
        {props.onTest && (
          <Button
            variant="outlined"
            disabled={dirty || save.loading}
            data-testid="automation-outline-test"
            onClick={props.onTest}
          >
            <Play className="size-4" />
            {dirty
              ? tr("automation.test.saveToTest")
              : tr("automation.outline.test")}
          </Button>
        )}
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
          data-testid="automation-outline-save"
          onClick={() => void save.run()}
        >
          {tr("automation.editor.save")}
        </Button>
      </div>
      {conflict && (
        <Alert data-testid="automation-outline-conflict">
          <AlertTitle>{tr("automation.editor.conflictTitle")}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>{tr("automation.editor.conflict")}</span>
            <Button
              variant="outlined"
              intent="danger"
              onClick={() => {
                setConflict(false);
                props.onReload?.();
              }}
            >
              {tr("automation.editor.reload")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div
          className={cn(
            "flex flex-col gap-4 rounded-xl p-3 sm:p-4",
            AutomationOutlineTones.CANVAS,
          )}
          data-testid="automation-outline"
        >
          {!reading.outline && !empty && (
            <p role="alert" className="text-warning-text text-sm">
              {reading.message}
            </p>
          )}
          {empty ? (
            <div
              className="bg-card ring-foreground/15 flex flex-col items-start gap-3 rounded-xl px-4 py-5 shadow-sm ring-1"
              data-testid="automation-outline-empty"
            >
              <div>
                <p className="font-medium">{tr("automation.outline.choose")}</p>
                <p className="text-muted-foreground text-sm">
                  {tr("automation.outline.chooseHint")}
                </p>
              </div>
              <AutomationOutlineEventMenu
                prominent
                label={tr("automation.outline.chooseEvent")}
                events={starts}
                disabled={save.loading}
                onPick={addBlock}
                testId="automation-outline-choose"
              />
              {presets.some((item) => !item.reason) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground text-xs">
                    {tr("automation.outline.quickStart")}
                  </span>
                  {presets
                    .filter((item) => !item.reason)
                    .map((item) => (
                      <Button
                        key={item.preset.key}
                        variant="outlined"
                        size="xs"
                        data-testid={`automation-outline-quick-${item.preset.key}`}
                        onClick={() => setMerging(item.preset)}
                      >
                        {tr(`automation.preset.${item.preset.key}.title`, {
                          default: item.preset.title,
                        })}
                      </Button>
                    ))}
                </div>
              )}
            </div>
          ) : (
            blocks.map((block) => (
              <AutomationOutlineBlockEditor
                key={block.key}
                graph={graph}
                block={block}
                catalog={catalog}
                names={names}
                issues={issues}
                open={open}
                onOpen={setOpen}
                folded={
                  several &&
                  holding !== block.key &&
                  (folded[block.key] ?? true)
                }
                onFold={(value) => {
                  setFolded((current) => ({ ...current, [block.key]: value }));
                  if (value && holding === block.key) setOpen(undefined);
                }}
                removable={several}
                disabled={save.loading}
                onChange={change}
                onAdd={add}
              />
            ))
          )}
          {!empty &&
            reading.outline &&
            (schedule ? null : (
              <div className="flex flex-wrap items-center gap-2">
                <AutomationOutlineEventMenu
                  label={tr("automation.outline.addBlock")}
                  events={starts.filter(
                    (item) => item.nodeType.type !== "schedule",
                  )}
                  presets={presets}
                  disabled={save.loading}
                  testId="automation-outline-add-block"
                  onPick={(nodeType) => {
                    addBlock(nodeType);
                  }}
                  onPickPreset={setMerging}
                />
              </div>
            ))}
        </div>
        <AutomationOutlineAside
          words={words}
          checks={checks}
          onReveal={reveal}
        />
      </div>
      <Dialog
        open={!!merging}
        onOpenChange={(value) => {
          if (!value) setMerging(undefined);
        }}
      >
        <DialogContent
          className="max-h-[85vh] overflow-y-auto"
          data-testid="automation-preset-merge"
        >
          <DialogHeader>
            <DialogTitle>
              {merging &&
                tr(`automation.preset.${merging.key}.title`, {
                  default: merging.title,
                })}
            </DialogTitle>
            <DialogDescription>
              {tr("automation.outline.mergeDescription")}
            </DialogDescription>
          </DialogHeader>
          {merging && (
            <AutomationPresetSetup
              key={merging.key}
              preset={merging}
              channels={catalog.channels}
              onCancel={() => setMerging(undefined)}
              onMerge={(values, bindings) => merge(merging, values, bindings)}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default AutomationOutlineEditor;
