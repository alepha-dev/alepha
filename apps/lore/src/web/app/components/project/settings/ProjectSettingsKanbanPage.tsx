import { Control } from "@alepha/ui/components/control/control";
import { settingsCardEdge } from "@alepha/ui/components/settings/settings-card-edge.ts";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Input } from "@alepha/ui/components/ui/input";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { cn } from "@alepha/ui/lib/utils";
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
import { useAlepha, useClient, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";

import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { userProjectsAtom } from "@/web/app/atoms/userProjectsAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { KanbanColumnOrder } from "./kanbanColumnOrder.ts";
import ProjectSettingsFeatureSection from "./ProjectSettingsFeatureSection.tsx";
import ProjectSettingsTagColors from "./ProjectSettingsTagColors.tsx";
import { useProjectFeatureToggle } from "./useProjectFeatureToggle.ts";

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

const ProjectSettingsKanbanPage = () => {
  const { enabled, toggle } = useProjectFeatureToggle("kanban");
  const toaster = useToast();
  const { tr } = useI18n<I18n, "en">();
  const alepha = useAlepha();
  const projectApi = useClient<ProjectController>();
  const [project] = useStore(currentProjectAtom);

  const persisted = project?.kanbanColumns ?? ["In Progress"];
  // Seeded once, on mount. There is deliberately no "the project changed
  // underneath us" reset: every project switch goes through
  // `router.path("project", …)` — the project root — so this page unmounts
  // and remounts rather than being handed another project's columns.
  const [columns, setColumns] = useState<string[]>(persisted);
  const [pending, setPending] = useState<string | null>(null);
  const dndId = useId();
  const sensors = useSensors(
    // The grip sits beside a text input; without a distance threshold a
    // click that grazes it starts a drag instead of focusing the field.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  if (!project) return null;

  const syncProject = (next: string[]) => {
    const updated = { ...project, kanbanColumns: next };
    alepha.store.set(currentProjectAtom, updated);
    const overview = alepha.store.get(userProjectsAtom);
    if (overview) {
      alepha.store.set(userProjectsAtom, {
        ...overview,
        // `currentProjectAtom` carries neither `areaCount` nor
        // `openQuestCount` — only
        // `getHomeOverview` computes that — so carry the existing one
        // forward rather than dropping it to 0.
        projects: overview.projects.map((c) =>
          c.id === updated.id
            ? {
                ...updated,
                areaCount: c.areaCount,
                openQuestCount: c.openQuestCount,
              }
            : c,
        ),
      });
    }
  };

  const runOp = async (label: string, fn: () => Promise<string[]>) => {
    setPending(label);
    try {
      const next = await fn();
      setColumns(next);
      syncProject(next);
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(null);
    }
  };

  const handleAdd = () =>
    runOp("add", () =>
      projectApi.addKanbanColumn({
        params: { id: project.id },
        body: { name: `Column ${columns.length + 1}` },
      }),
    );

  const handleRename = (oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    return runOp(`rename:${oldName}`, () =>
      projectApi.renameKanbanColumn({
        params: { id: project.id },
        body: { oldName, newName: trimmed },
      }),
    );
  };

  const handleDelete = (name: string) =>
    runOp(`delete:${name}`, () =>
      projectApi.deleteKanbanColumn({
        params: { id: project.id },
        body: { name },
      }),
    );

  /**
   * Per-column settings: which lifecycle state the column collapses to
   * (#1227) and its WIP limit (#1228).
   *
   * The whole map goes over the wire, because removing a key is how a
   * setting is cleared and a server-side merge has no way to say that.
   */
  const setColumnSettings = async (
    name: string,
    patch: { status?: "new" | "accepted" | "completed"; wipLimit?: number },
  ) => {
    const current = project.kanbanColumnConfig ?? {};
    const merged = { ...current[name], ...patch };
    // Strip keys back to absent rather than storing a default: "accepted"
    // and "no limit" are what a column means with no entry at all, so
    // writing them would leave two encodings of one state.
    const settings: Record<string, unknown> = {};
    if (merged.status && merged.status !== "accepted") {
      settings.status = merged.status;
    }
    if (merged.wipLimit) settings.wipLimit = merged.wipLimit;

    const next = { ...current };
    if (Object.keys(settings).length) {
      next[name] = settings as (typeof current)[string];
    } else {
      delete next[name];
    }

    setPending(`settings:${name}`);
    try {
      const updated = await projectApi.updateProjectById({
        params: { id: project.id },
        body: { kanbanColumnConfig: next },
      });
      alepha.store.set(currentProjectAtom, updated);
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(null);
    }
  };

  const handleReorder = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const next = columnOrder.move(columns, String(active.id), String(over.id));
    // `move` returns the input identity for a no-op — a drop on itself, or a
    // name that is no longer in the list. The server would refuse the second
    // and ignore the first, so neither is worth a round trip.
    if (next === columns) return;

    // Optimistic: the row has to follow the cursor's release immediately, so
    // paint the new order first and let `runOp`'s error path put the
    // persisted one back.
    const previous = columns;
    setColumns(next);
    return runOp("reorder", () =>
      projectApi
        .reorderKanbanColumns({
          params: { id: project.id },
          body: { columns: next },
        })
        .catch((error) => {
          setColumns(previous);
          throw error;
        }),
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <ProjectSettingsFeatureSection
        featureKey="kanban"
        enabled={enabled}
        onToggle={toggle}
      />

      {enabled && (
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
                    disabled={pending !== null}
                    status={
                      project.kanbanColumnConfig?.[col]?.status ?? "accepted"
                    }
                    wipLimit={project.kanbanColumnConfig?.[col]?.wipLimit}
                    onRename={(newName) => handleRename(col, newName)}
                    onDelete={() => handleDelete(col)}
                    onSettings={(patch) => void setColumnSettings(col, patch)}
                  />
                ))}
              </DndContext>
            </div>

            <div>
              <Button
                variant="outline"
                size="sm"
                disabled={columns.length >= MAX_COLUMNS || pending !== null}
                onClick={handleAdd}
              >
                <Plus className="size-3.5" />
                {tr("project.settings.kanban.columns.add")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {enabled && (
        <Card className={cn(settingsCardEdge, "py-4")}>
          <CardContent className="px-4">
            <ProjectSettingsTagColors />
          </CardContent>
        </Card>
      )}
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
  status: "new" | "accepted" | "completed";
  wipLimit?: number;
  onRename: (next: string) => void;
  onDelete: () => void;
  onSettings: (patch: {
    status?: "new" | "accepted" | "completed";
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
          "aria-label": String(tr("project.settings.kanban.columns.status")),
        }}
        triggerClassName="h-8 text-xs"
        items={[
          {
            value: "new",
            label: String(tr("project.settings.kanban.columns.status.new")),
          },
          {
            value: "accepted",
            label: String(
              tr("project.settings.kanban.columns.status.accepted"),
            ),
          },
          {
            value: "completed",
            label: String(
              tr("project.settings.kanban.columns.status.completed"),
            ),
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
        aria-label={String(tr("project.settings.kanban.columns.wip"))}
        placeholder={String(tr("project.settings.kanban.columns.wip.none"))}
        className="h-8 w-20 text-xs"
        onChange={(e) => {
          const raw = Number(e.currentTarget.value);
          props.onSettings({
            wipLimit: Number.isFinite(raw) && raw > 0 ? raw : undefined,
          });
        }}
      />
      <Button
        variant="ghost"
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

export default ProjectSettingsKanbanPage;
