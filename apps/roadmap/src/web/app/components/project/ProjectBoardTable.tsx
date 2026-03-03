import { DataTable, Flex, Text } from "@alepha/ui";
import { Badge } from "@mantine/core";
import { IconSignature, IconTrash, IconUser } from "@tabler/icons-react";
import { t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useAlepha, useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useEffect, useState } from "react";
import type { ChapterController } from "@/api/controllers/ChapterController.ts";
import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import type { TaskController } from "@/api/controllers/TaskController.ts";
import type { User } from "@/api/entities/users.ts";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentAssignedTasksAtom } from "../../atoms/currentAssignedTasksAtom.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import TaskComplexity from "./task/TaskComplexity.tsx";

const filtersSchema = t.object({
  status: t.optional(t.enum(["new", "accepted", "completed"])),
  search: t.optional(t.string()),
  chapterId: t.optional(t.integer()),
  package: t.optional(t.string()),
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
  const alepha = useAlepha();
  const [project] = useStore(currentProjectAtom);
  const taskApi = useClient<TaskController>();
  const projectApi = useClient<ProjectController>();
  const chapterApi = useClient<ChapterController>();
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
    <DataTable<TaskResource, typeof filtersSchema>
      key={project.id}
      submitOnInit
      infinityScroll
      defaultSize={20}
      emptyLabel={tr("common.noResults")}
      filters={t.object({
        status: t.optional(t.enum(["new", "accepted", "completed"])),
        search: t.optional(t.string()),
        chapterId: t.optional(
          t.integer({
            title: "Chapter",
          }),
        ),
        package: t.optional(t.string()),
      })}
      typeFormProps={{
        fieldControlProps: {
          chapterId: {
            select: {
              loader: async (search) => {
                const chapters = await chapterApi.getChapters({
                  params: { projectId: project.id },
                });
                return chapters.map((ch) => ({
                  value: String(ch.id),
                  label: `Ch.${ch.number}: ${ch.title} (${ch.questCount} quests)`,
                }));
              },
            },
          },
          package: {
            select: {
              loader: async () =>
                project.packages.map((p) => ({ value: p, label: p })),
            },
          },
        },
      }}
      items={async (query) => {
        return taskApi.getTasks({
          params: { projectId: project.id },
          query,
        });
      }}
      columns={{
        assignedTo: {
          label: "Assigned",
          value: (task) =>
            task.acceptedBy ? (
              <Flex gap={"xs"}>
                {renderAvatar(task.acceptedBy)}
                {users.find((u) => u.id === task.acceptedBy)?.username}
              </Flex>
            ) : (
              "-"
            ),
        },
        status: {
          label: "Status",
          value: (task) => {
            const columnColors: Record<string, string> = {
              new: "var(--mantine-color-blue-5)",
              accepted: "var(--mantine-color-orange-5)",
              completed: "var(--mantine-color-green-5)",
            };
            const color = columnColors[task.metadata.status];
            return (
              <Flex
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  backgroundColor: color,
                }}
              />
            );
          },
        },
        title: {
          label: "Quest",
          sortable: true,
          action: (task) => ({
            href: router.path("projectTask", {
              params: { taskId: String(task.id) },
            }),
          }),
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
                  {removeHtmlTags(task.description.slice(0, 60))}
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
              variant="dot"
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
              {dateFormatter.of(task.createdAt).fromNow()}
            </Text>
          ),
        },
        updatedAt: {
          label: "UpdatedAt",
          sortable: true,

          value: (task) => (
            <Text size="xs" c="dimmed">
              {dateFormatter.of(task.updatedAt).fromNow()}
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
            const updatedTask = await taskApi.acceptTask({
              params: { id: task.id },
            });
            alepha.store.set(currentAssignedTasksAtom, [
              ...(alepha.store.get(currentAssignedTasksAtom) ?? []),
              updatedTask,
            ]);
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
    />
  );
};

export default ProjectBoardTable;
