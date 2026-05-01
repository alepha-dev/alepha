import { Control } from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import { t } from "alepha";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { FileText, ListChecks, Plus, Save, Tag, Tent } from "lucide-react";
import type { TaskController } from "@/api/controllers/TaskController.ts";
import type { Project } from "@/api/entities/projects.ts";
import { taskCreateSchema } from "@/api/schemas/taskCreateSchema.ts";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentAssignedTasksAtom } from "@/web/app/atoms/currentAssignedTasksAtom.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { kanbanProjectAtom } from "@/web/app/atoms/kanbanProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import TextEditor from "../../shared/TextEditor.tsx";
import TaskCreateObjectives from "./TaskCreateObjectives.tsx";

export interface TaskCreateProps {
  onSubmit: (task: TaskResource) => void;
  onCreated?: (task: TaskResource) => void;
  task?: Partial<TaskResource>;
  project: Project;
}

const TaskCreate = (props: TaskCreateProps) => {
  const taskApi = useClient<TaskController>();
  const alepha = useAlepha();
  const router = useRouter<AppRouter>();
  const { tr } = useI18n<I18n, "en">();
  const [currentProject, setCurrentProject] = useStore(currentProjectAtom);
  const [kanbanProject] = useStore(kanbanProjectAtom);

  const update = !!props.task?.id;

  const form = useForm({
    id: "task-create",
    schema: t.omit(taskCreateSchema, ["projectId"]),
    initialValues: props.task as TaskResource,
    handler: async (data) => {
      if (props.task?.id) {
        const resp = await taskApi.updateTaskById({
          params: { id: props.task.id },
          body: data,
        });
        alepha.store.set(currentAssignedTasksAtom, [
          resp,
          ...(alepha.store.get(currentAssignedTasksAtom) ?? []).filter(
            (task) => task.id !== resp.id,
          ),
        ]);
        props.onSubmit(resp);
        return;
      }

      const task = await taskApi.createTask({
        body: { ...data, projectId: props.project.id },
      });

      if (
        data.package &&
        !props.project.packages?.includes(data.package) &&
        currentProject
      ) {
        const updatedPackages = [
          ...(currentProject.packages || []),
          data.package,
        ];
        setCurrentProject({ ...currentProject, packages: updatedPackages });
      }

      props.onSubmit(task);

      if (props.onCreated) {
        props.onCreated(task);
      } else {
        await router.push("projectTask", {
          params: {
            projectId: String(props.project.id),
            taskId: String(task.id),
          },
        });
      }
    },
  });

  const packages =
    currentProject?.packages || kanbanProject?.project?.packages || [];

  return (
    <form {...form.props} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Control
          label={tr("task.create.title")}
          description={tr("task.create.title.helper")}
          input={form.input.title}
          icon={Tag}
        />
        <Control
          label={tr("task.create.package")}
          description={tr("task.create.package.helper")}
          input={form.input.package}
          icon={Tent}
          combobox
        />
      </div>

      <Control
        label={tr("task.create.description")}
        description={tr("task.create.description.helper")}
        input={form.input.description}
        icon={FileText}
        custom={TextEditor as never}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Control
          input={form.input.priority}
          label={tr("task.create.priority")}
          description={tr("task.create.priority.helper")}
          segmented
        />
        <Control
          input={form.input.complexity}
          label={tr("task.create.complexity")}
          description={tr("task.create.complexity.helper")}
          segmented
        />
      </div>

      <Control
        label={tr("task.create.objectives")}
        description={tr("task.create.objectives.helper")}
        input={form.input.objectives}
        icon={ListChecks}
        custom={TaskCreateObjectives as never}
      />

      {/* package suggestions: hint */}
      {packages.length > 0 && (
        <p className="text-muted-foreground text-xs">
          Existing zones: {packages.join(", ")}
        </p>
      )}

      <div className="flex">
        {update ? (
          <Button type="submit" disabled={form.submitting}>
            <Save className="size-4" />
            {tr("task.create.update")}
          </Button>
        ) : (
          <Button type="submit" disabled={form.submitting}>
            <Plus className="size-4" />
            {tr("task.create.submit")}
          </Button>
        )}
      </div>
    </form>
  );
};

export default TaskCreate;
