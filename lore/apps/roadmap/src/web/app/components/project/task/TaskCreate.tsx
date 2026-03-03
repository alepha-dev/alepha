import { ActionButton, Control, Flex } from "@alepha/ui";
import { SimpleGrid } from "@mantine/core";
import {
  IconDeviceFloppy,
  IconFileText,
  IconListCheck,
  IconPlus,
  IconTag,
  IconTent,
} from "@tabler/icons-react";
import { t } from "alepha";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
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
        body: {
          ...data,
          projectId: props.project.id,
        },
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
    <form {...form.props}>
      <Flex direction="column" gap="md">
        <SimpleGrid
          cols={{
            base: 1,
            md: 2,
          }}
          spacing={"sm"}
        >
          <Control
            label={tr("task.create.title")}
            description={tr("task.create.title.helper")}
            input={form.input.title}
            icon={<IconTag />}
          />
          <Control
            label={tr("task.create.package")}
            description={tr("task.create.package.helper")}
            input={form.input.package}
            icon={<IconTent />}
            select={{
              creatable: true,
              loader: () => packages,
              selectProps: {
                placeholder: "Enter or select a zone...",
                limit: 5,
              },
            }}
          />
        </SimpleGrid>

        <Control
          description={tr("task.create.description.helper")}
          label={tr("task.create.description")}
          custom={TextEditor}
          input={form.input.description}
          icon={<IconFileText />}
        />

        <SimpleGrid
          cols={{
            base: 1,
            md: 2,
          }}
          spacing={"sm"}
        >
          <Control
            input={form.input.priority}
            label={tr("task.create.priority")}
            description={tr("task.create.priority.helper")}
            segmented
            select={{
              segmentedProps: {
                data: [
                  {
                    label: String(tr("priority.high")),
                    value: "high",
                  },
                  {
                    label: String(tr("priority.medium")),
                    value: "medium",
                  },
                  {
                    label: String(tr("priority.low")),
                    value: "low",
                  },
                  {
                    label: String(tr("priority.none")),
                    value: "optional",
                  },
                ],
              },
            }}
          />
          <Control
            input={form.input.complexity}
            label={tr("task.create.complexity")}
            description={tr("task.create.complexity.helper")}
            segmented
            select={{
              segmentedProps: {
                data: [
                  {
                    label: "S",
                    value: "5",
                  },
                  {
                    label: "A",
                    value: "4",
                  },
                  {
                    label: "B",
                    value: "3",
                  },
                  {
                    label: "C",
                    value: "2",
                  },
                  {
                    label: "F",
                    value: "1",
                  },
                ],
              },
            }}
          />
        </SimpleGrid>

        <Control
          label={tr("task.create.objectives")}
          description={tr("task.create.objectives.helper")}
          custom={TaskCreateObjectives}
          input={form.input.objectives}
          icon={<IconListCheck />}
        />

        <br />

        <Flex>
          {update ? (
            <ActionButton
              variant={"filled"}
              color={"blue"}
              form={form}
              leftSection={<IconDeviceFloppy />}
            >
              {tr("task.create.update")}
            </ActionButton>
          ) : (
            <ActionButton
              variant={"filled"}
              color={"green"}
              form={form}
              leftSection={<IconPlus />}
            >
              {tr("task.create.submit")}
            </ActionButton>
          )}
        </Flex>
      </Flex>
    </form>
  );
};

export default TaskCreate;
