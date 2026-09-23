import { Button, Card, CardContent, Input, cn } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { settingsCardEdge } from "@alepha/ui/settings";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { z } from "alepha";
import { useAction, useAlepha, useClient, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";

import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { setCurrentProject } from "@/web/app/services/currentProjectWrite.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import {
  capabilityOption,
  hasCapability,
} from "@/web/app/services/projectCapabilities.ts";

import { useKanbanColumnOps } from "../../kanban/useKanbanColumnOps.ts";
import { KanbanColumnOrder } from "./kanbanColumnOrder.ts";
import ProjectSettingsAgentPrompts from "./ProjectSettingsAgentPrompts.tsx";
import ProjectSettingsCapabilitySection from "./ProjectSettingsCapabilitySection.tsx";
import ProjectSettingsRoadmapSection from "./ProjectSettingsRoadmapSection.tsx";
import ProjectSettingsTagColors from "./ProjectSettingsTagColors.tsx";

const MAX_COLUMNS = 5;

/**
 * The status picker's own one-field form.
 *
 * `z.text()` rather than the lifecycle enum, because the rows are handed to
 * the control as `items`: the three labels are localized, so an enum here
 * would restate the triple without being the list that renders. Required, so
 * a column always maps onto a state.
 */
const columnStatusSchema = z.object({
  status: z.text(),
});

/**
 * Stateless, so one instance serves every mount.
 */
const columnOrder = new KanbanColumnOrder();

/**
 * Work: the capability, its six options, and the configuration that only
 * means anything once the board is on.
 *
 * It was the Kanban page. Four single-switch pages (Epics, Releases, Quests,
 * and Folios' master) folded into the section at the top, which is where the
 * nine Features pages went: four of them were a switch and nothing else.
 */
const ProjectSettingsWorkPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const alepha = useAlepha();
  const projectApi = useClient<ProjectController>();
  const [project] = useStore(currentProjectAtom);
  const workEnabled = hasCapability(project, "work");
  const boardEnabled = capabilityOption(project, "work", "board");

  const persisted = project?.kanbanColumns ?? ["In Progress"];
  // Seeded once, on mount. There is deliberately no "the project changed
  // underneath us" reset: every project switch goes through
  // `router.path("project", …)` — the project root — so this page unmounts
  // and remounts rather than being handed another project's columns.
  const [columns, setColumns] = useState<string[]>(persisted);
  const dndId = useId();
  const sensors = useSensors(
    // The grip sits beside a text input; without a distance threshold a
    // click that grazes it starts a drag instead of focusing the field.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  /**
   * Add, rename and delete go through the board's own hook, so Settings and
   * the board ask the server the same question and keep the same two atoms
   * true (#Q2324). The list here is re-read from `currentProjectAtom` after
   * each of them, which is what the hook has just written.
   */
  const columnOps = useKanbanColumnOps(project?.id ?? 0, () =>
    setColumns(
      alepha.store.get(currentProjectAtom)?.kanbanColumns ?? ["In Progress"],
    ),
  );

  /**
   * Per-column settings: which lifecycle state the column collapses to
   * (#1227) and its WIP limit (#1228).
   *
   * The whole map goes over the wire, because removing a key is how a
   * setting is cleared and a server-side merge has no way to say that.
   */
  const settingsAction = useAction<
    [
      name: string,
      patch: {
        status?: "todo" | "in_progress" | "completed";
        wipLimit?: number;
      },
    ],
    void
  >(
    {
      handler: async (name, patch) => {
        if (!project) return;
        const current = project.kanbanColumnConfig ?? {};
        const merged = { ...current[name], ...patch };
        // Strip keys back to absent rather than storing a default:
        // "in_progress" and "no limit" are what a column means with no entry
        // at all, so writing them would leave two encodings of one state.
        const settings: Record<string, unknown> = {};
        if (merged.status && merged.status !== "in_progress") {
          settings.status = merged.status;
        }
        if (merged.wipLimit) settings.wipLimit = merged.wipLimit;

        const next = { ...current };
        if (Object.keys(settings).length) {
          next[name] = settings as (typeof current)[string];
        } else {
          delete next[name];
        }

        const updated = await projectApi.updateProjectById({
          params: { id: project.id },
          body: { kanbanColumnConfig: next },
        });
        setCurrentProject(alepha, updated);
      },
    },
    [projectApi, alepha, project],
  );

  const reorderAction = useAction<[next: string[], previous: string[]], void>(
    {
      handler: async (next, previous) => {
        if (!project) return;
        // Optimistic: the row has to follow the cursor's release immediately,
        // so the new order is painted first, and a refusal puts the persisted
        // one back and rethrows, which is what reports it.
        setColumns(next);
        try {
          await projectApi.reorderKanbanColumns({
            params: { id: project.id },
            body: { columns: next },
          });
        } catch (error) {
          setColumns(previous);
          throw error;
        }
        setCurrentProject(alepha, { ...project, kanbanColumns: next });
      },
    },
    [projectApi, alepha, project],
  );

  /**
   * Every column control waits while any of these runs (#E59 rule 10): the
   * rows used to be held by a key naming the operation in flight, and over
   * `useAction` a second row's control would take a click and drop it.
   */
  const busy =
    columnOps.loading || settingsAction.loading || reorderAction.loading;

  if (!project) return null;

  const handleAdd = () => void columnOps.add(`Column ${columns.length + 1}`);

  const handleRename = (oldName: string, newName: string) =>
    void columnOps.rename(oldName, newName);

  const handleDelete = (name: string) => void columnOps.remove(name);

  const handleReorder = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const next = columnOrder.move(columns, String(active.id), String(over.id));
    // `move` returns the input identity for a no-op — a drop on itself, or a
    // name that is no longer in the list. The server would refuse the second
    // and ignore the first, so neither is worth a round trip.
    if (next === columns) return;

    void reorderAction.run(next, columns);
  };

  return (
    <div className="flex flex-col gap-4">
      <ProjectSettingsCapabilitySection capability="work" />

      {/* Column configuration only means anything once the board exists, so
          it hangs off the option rather than the capability. */}
      {boardEnabled && (
        <Card className={cn(settingsCardEdge, "py-4")}>
          <CardContent className="flex flex-col gap-3 px-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">
                {tr("project.settings.kanban.columns.title")}
              </span>
              <span className="text-muted-foreground text-xs">
                {tr("project.settings.kanban.columns.description")}
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <DndContext
                id={dndId}
                sensors={sensors}
                onDragEnd={handleReorder}
              >
                {columns.map((col) => (
                  <ColumnRow
                    key={col}
                    name={col}
                    disabled={busy || !projectApi.updateProjectById.can()}
                    status={
                      project.kanbanColumnConfig?.[col]?.status ?? "in_progress"
                    }
                    wipLimit={project.kanbanColumnConfig?.[col]?.wipLimit}
                    onRename={(newName) => handleRename(col, newName)}
                    onDelete={() => handleDelete(col)}
                    onSettings={(patch) => void settingsAction.run(col, patch)}
                  />
                ))}
              </DndContext>
            </div>

            <div>
              <Button
                variant="outlined"
                size="sm"
                disabled={
                  columns.length >= MAX_COLUMNS ||
                  busy ||
                  !projectApi.addKanbanColumn.can()
                }
                onClick={handleAdd}
              >
                <Plus className="size-3.5" />
                {tr("project.settings.kanban.columns.add")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tag colours belong to quests, not to the board: they render on the
          list too. Gated on the capability, not on `board`. */}
      {workEnabled && (
        <Card className={cn(settingsCardEdge, "py-4")}>
          <CardContent className="px-4">
            <ProjectSettingsTagColors />
          </CardContent>
        </Card>
      )}

      {/* Who may read `/:projectSlug/roadmap`. It draws releases and the
          epics inside them, so it moved here with them from the Releases
          page. */}
      {workEnabled && <ProjectSettingsRoadmapSection />}

      {/* The four agent prompt templates. It renders nothing while the
          `agentPrompts` option is off, and the switch that turns it on is
          generated by the capability section above off the registry entry,
          not written here. */}
      <ProjectSettingsAgentPrompts />
    </div>
  );
};

interface ColumnRowProps {
  name: string;
  disabled: boolean;
  /**
   * Which lifecycle state this column collapses to. The triple stays the
   * truth; a column only maps onto it (#1227).
   */
  status: "todo" | "in_progress" | "completed";
  wipLimit?: number;
  onRename: (next: string) => void;
  onDelete: () => void;
  onSettings: (patch: {
    status?: "todo" | "in_progress" | "completed";
    wipLimit?: number;
  }) => void;
}

const ColumnRow = (props: ColumnRowProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [value, setValue] = useState(props.name);

  // `keepDirty: false` so the row follows the saved column: a refused or
  // rolled-back patch leaves `props.status` where it was, and the trigger
  // has to go back with it.
  const statusForm = useForm({
    schema: columnStatusSchema,
    initialValues: { status: props.status },
    keepDirty: false,
    handler: async () => {},
    onChange: (_key, next) =>
      props.onSettings({ status: next as ColumnRowProps["status"] }),
  });

  // The name is the identity the reorder endpoint speaks in, and it is
  // unique by construction — `addKanbanColumn` / `renameKanbanColumn`
  // refuse a duplicate.
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    setActivatorNodeRef,
    transform,
    isDragging,
  } = useDraggable({ id: props.name, disabled: props.disabled });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: props.name });

  return (
    <div
      ref={(node) => {
        // One element is both the thing that moves and the thing you drop
        // onto, so it carries both refs.
        setDragRef(node);
        setDropRef(node);
      }}
      data-testid="kanban-settings-column"
      data-column-name={props.name}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.5 : undefined,
      }}
      className={cn(
        "border-border bg-muted/30 flex items-center gap-2 rounded-md border px-2 py-1.5",
        isOver && !isDragging && "border-primary",
      )}
    >
      {/*
        Only the grip is the activator: the row holds a text input, and
        making the whole row draggable would swallow every click into it.
        A real <button> rather than the bare icon, both because dnd-kit's
        activator ref wants an HTMLElement and because this is the control
        that reorders the board — it has to be reachable by keyboard.
      */}
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...listeners}
        {...attributes}
        aria-label={tr("project.settings.kanban.columns.reorder")}
        disabled={props.disabled}
        className={cn(
          "text-muted-foreground shrink-0 rounded-sm",
          "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
          props.disabled
            ? "cursor-not-allowed"
            : isDragging
              ? "cursor-grabbing"
              : "cursor-grab",
        )}
      >
        <GripVertical className="size-4" />
      </button>
      <Input
        value={value}
        disabled={props.disabled}
        onChange={(e) => setValue(e.currentTarget.value)}
        onBlur={() => {
          if (value !== props.name) props.onRename(value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            setValue(props.name);
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        placeholder={tr("project.settings.kanban.columns.placeholder")}
        className="h-8 flex-1 text-sm"
      />
      <Control
        input={statusForm.input.status}
        label=""
        disabled={props.disabled}
        inputProps={{
          "data-testid": "kanban-column-status",
          "aria-label": tr("project.settings.kanban.columns.status"),
        }}
        triggerClassName="h-8 text-xs"
        items={[
          {
            value: "todo",
            label: tr("project.settings.kanban.columns.status.todo"),
          },
          {
            value: "in_progress",
            label: tr("project.settings.kanban.columns.status.inProgress"),
          },
          {
            value: "completed",
            label: tr("project.settings.kanban.columns.status.completed"),
          },
        ]}
      />
      <Input
        type="number"
        min={1}
        max={999}
        value={props.wipLimit ?? ""}
        disabled={props.disabled}
        data-testid="kanban-column-wip"
        aria-label={tr("project.settings.kanban.columns.wip")}
        placeholder={tr("project.settings.kanban.columns.wip.none")}
        className="h-8 w-20 text-xs"
        onChange={(e) => {
          const raw = Number(e.currentTarget.value);
          props.onSettings({
            wipLimit: Number.isFinite(raw) && raw > 0 ? raw : undefined,
          });
        }}
      />
      <Button
        variant="minimal"
        size="sm"
        disabled={props.disabled}
        onClick={props.onDelete}
        aria-label={tr("project.settings.kanban.columns.delete")}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
};

export default ProjectSettingsWorkPage;
