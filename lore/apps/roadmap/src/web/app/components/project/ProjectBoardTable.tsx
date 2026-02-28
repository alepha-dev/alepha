import { DataTable, Flex, Text } from "@alepha/ui";
import { Badge } from "@mantine/core";
import { IconSignature, IconTrash, IconUser } from "@tabler/icons-react";
import { t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useEffect, useState } from "react";
import type { ProjectController } from "../../../../api/controllers/ProjectController.ts";
import type { TaskController } from "../../../../api/controllers/TaskController.ts";
import type { Task } from "../../../../api/entities/tasks.ts";
import type { User } from "../../../../api/entities/users.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import TaskComplexity from "./task/TaskComplexity.tsx";

const filtersSchema = t.object({
  status: t.optional(t.enum(["new", "accepted", "completed"])),
  search: t.optional(t.string()),
  chapterId: t.optional(t.integer()),
});

const getPriorityColor = (priority: string) => {
  switch (priority) {
    case "high":
      return "red";
    case "medium":
      return "orange";
    case "low":
      return "gray";
    default:
      return "dark";
  }
};

const removeHtmlTags = (text: string) => {
  return text.replace(/<[^>]*>/g, "");
};

const ProjectBoardTable = () => {
  const [project] = useStore(currentProjectAtom);
  const taskApi = useClient<TaskController>();
  const projectApi = useClient<ProjectController>();
  const dateFormatter = useInject(DateTimeProvider);
  const router = useRouter<AppRouter>();
  const { tr } = useI18n<I18n, "en">();
  const [users, setUsers] = useState<Array<User>>([]);

  useEffect(() => {
    if (!project?.id) return;
    projectApi
      .getProjectUsers({ params: { id: project.id } })
      .then(setUsers)
      .catch(() => null);
  }, [project?.id]);

  const renderAvatar = (userId?: string) => {
    if (userId) {
      const user = users.find((u) => u.id === userId);
      if (user?.picture) {
        return (
          <img
            alt="user avatar"
            style={{
              height: "24px",
              width: "24px",
              borderRadius: "50%",
            }}
            src={`/api/files/${user.picture}`}
          />
        );
      }
    }
    return <IconUser />;
  };

  if (!project) return null;

  return (
    <DataTable<Task, typeof filtersSchema>
      submitOnInit
      defaultSize={10}
      emptyLabel={tr("common.noResults")}
      filters={filtersSchema}
      items={async (filters) => {
        return taskApi.getTasks({
          params: { projectId: project.id },
          query: {
            status: filters.status || undefined,
            search: filters.search || undefined,
            chapterId: filters.chapterId || undefined,
            page: filters.page,
            size: filters.size,
            sort: filters.sort || undefined,
          },
        });
      }}
      columns={{
        assignedTo: {
          label: "Assigned",
          value: (task) => (
            <Flex gap={"xs"}>
              {renderAvatar(task.acceptedBy)}
              {users.find((u) => u.id === task.acceptedBy)?.username}
            </Flex>
          ),
        },
        title: {
          label: "Quest",
          sortable: true,
          value: (task) => (
            <Flex
              direction="column"
              style={{ overflow: "hidden", whiteSpace: "nowrap" }}
            >
              <Text
                td={task.completedAt ? "line-through" : undefined}
                c={task.completedAt ? "dimmed" : undefined}
                fw={500}
                size="sm"
                lineClamp={1}
              >
                {task.title}
              </Text>
              {task.description && (
                <Text style={{ textOverflow: "ellipsis" }} size="xs" c="dimmed">
                  {removeHtmlTags(task.description.slice(0, 100))}
                </Text>
              )}
            </Flex>
          ),
        },
        priority: {
          label: "Priority",
          sortable: true,

          value: (task) => (
            <Badge
              size="sm"
              color={getPriorityColor(task.priority)}
              variant="light"
            >
              {task.priority}
            </Badge>
          ),
        },
        complexity: {
          label: "Rank",
          sortable: true,

          value: (task) => <TaskComplexity complexity={task.complexity} />,
        },
        package: {
          label: "Zone",
          sortable: true,

          value: (task) => <Text size="xs">{task.package}</Text>,
        },
        createdAt: {
          label: "Created",
          sortable: true,

          value: (task) => (
            <Text size="xs" c="dimmed">
              {dateFormatter.of(task.completedAt ?? task.createdAt).fromNow()}
            </Text>
          ),
        },
      }}
      rowActions={(task) => [
        {
          icon: IconSignature,
          label: "Accept Quest",
          color: "blue",
          visible: !task.acceptedAt && taskApi.acceptTask.can(),
          onClick: async () => {
            await taskApi.acceptTask({ params: { id: task.id } });
          },
        },
        {
          icon: IconTrash,
          label: "Delete Quest",
          color: "red",
          visible: taskApi.deleteTask.can(),
          onClick: async () => {
            await taskApi.deleteTask({ params: { id: task.id } });
          },
        },
      ]}
      tableTrProps={(task) => ({
        style: { cursor: "pointer" },
        onClick: () =>
          router.push("projectTask", {
            params: { taskId: String(task.id) },
            meta: { transition: "fadeInUp" },
          }),
      })}
    />
  );
};

export default ProjectBoardTable;
