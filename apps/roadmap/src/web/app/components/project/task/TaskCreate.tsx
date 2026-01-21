import { useAlepha, useClient, useStore } from "@alepha/react";
import { useForm } from "@alepha/react/form";
import { useI18n } from "@alepha/react/i18n";
import { useRouter } from "@alepha/react/router";
import { ActionButton } from "@alepha/ui";
import { Flex, SimpleGrid, Space, Stack } from "@mantine/core";
import {
  IconDeviceFloppy,
  IconFileText,
  IconListCheck,
  IconPaperclip,
  IconPlus,
  IconTag,
  IconTent,
} from "@tabler/icons-react";
import { t } from "alepha";
import type { TaskController } from "../../../../../api/controllers/TaskController.ts";
import type { Project } from "../../../../../api/entities/projects.ts";
import type { Task } from "../../../../../api/entities/tasks.ts";
import { taskCreateSchema } from "../../../../../api/schemas/taskCreateSchema.ts";
import type { AppRouter } from "../../../AppRouter.ts";
import { currentAssignedTasksAtom } from "../../../atoms/currentAssignedTasksAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import TextEditor from "../../shared/TextEditor.tsx";
import Control from "../../ui/Control.tsx";
import TaskAttachments from "./TaskAttachments.tsx";
import TaskCreateObjectives from "./TaskCreateObjectives.tsx";

export interface TaskCreateProps {
  onSubmit: (task: Task) => void;
  task?: Partial<Task>;
  project: Project;
}

const TaskCreate = (props: TaskCreateProps) => {
  const taskApi = useClient<TaskController>();
  const alepha = useAlepha();
  const router = useRouter<AppRouter>();
  const { tr } = useI18n<I18n, "en">();
  const [currentProject, setCurrentProject] = useStore(currentProjectAtom);

  const update = !!props.task?.id;

  const form = useForm({
    id: "task-create",
    schema: t.omit(taskCreateSchema, ["projectId"]),
    initialValues: props.task as Task,
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

      await router.go("projectTask", {
        params: {
          projectId: String(props.project.id),
          taskId: String(task.id),
        },
      });
    },
  });

  return (
    <form {...form.props}>
      <Stack>
        <SimpleGrid
          cols={{
            base: 1,
            md: 2,
          }}
          spacing={"sm"}
        >
          <Control
            title={tr("task.create.title")}
            description={tr("task.create.title.helper")}
            input={form.input.title}
            icon={<IconTag />}
          />
          <Control
            title={tr("task.create.package")}
            description={tr("task.create.package.helper")}
            input={form.input.package}
            icon={<IconTent />}
            autocomplete={{
              data: currentProject?.packages || [],
              placeholder: "Enter or select a zone...",
              limit: 5,
            }}
          />
        </SimpleGrid>

        <Control
          description={tr("task.create.description.helper")}
          title={tr("task.create.description")}
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
            title={tr("task.create.priority")}
            description={tr("task.create.priority.helper")}
            segmented={{
              data: [
                {
                  label: tr("priority.high"),
                  value: "high",
                },
                {
                  label: tr("priority.medium"),
                  value: "medium",
                },
                {
                  label: tr("priority.low"),
                  value: "low",
                },
                {
                  label: tr("priority.none"),
                  value: "optional",
                },
              ],
            }}
          />
          <Control
            input={form.input.complexity}
            title={tr("task.create.complexity")}
            description={tr("task.create.complexity.helper")}
            segmented={{
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
            }}
          />
        </SimpleGrid>

        <Control
          title={tr("task.create.objectives")}
          description={tr("task.create.objectives.helper")}
          custom={TaskCreateObjectives}
          input={form.input.objectives}
          icon={<IconListCheck />}
        />

        <Control
          title={tr("task.create.attachments")}
          description={tr("task.create.attachments.helper")}
          custom={TaskAttachments}
          input={form.input.attachments}
          icon={<IconPaperclip />}
        />

        <Space />

        <Flex>
          {update ? (
            <ActionButton
              variant={"filled"}
              color={"blue"}
              form={form}
              leftSection={<IconDeviceFloppy />}
            >
              Update Quest
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
      </Stack>
    </form>
  );
};

export default TaskCreate;
