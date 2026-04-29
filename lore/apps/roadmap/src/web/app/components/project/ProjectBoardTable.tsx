import { AlephaTable } from "@alepha/ui/components/alepha-table";
import { Badge } from "@alepha/ui/components/ui/badge";
import { DateTimeProvider } from "alepha/datetime";
import { useAlepha, useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Signature, Trash, User as UserIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import type { TaskController } from "@/api/controllers/TaskController.ts";
import type { User } from "@/api/entities/users.ts";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentAssignedTasksAtom } from "../../atoms/currentAssignedTasksAtom.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import TaskComplexity from "./task/TaskComplexity.tsx";

const getPriorityColor = (priority: string) => {
  switch (priority) {
    case "high":
      return "bg-red-500/15 text-red-600";
    case "medium":
      return "bg-orange-500/15 text-orange-600";
    case "low":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
};

const removeHtmlTags = (text: string) => text.replace(/<[^>]*>/g, "");

const ProjectBoardTable = () => {
  const alepha = useAlepha();
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
            className="size-6 rounded-full"
            src={`/api/files/${user.picture}`}
          />
        );
      }
    }
    return <UserIcon className="size-4" />;
  };

  if (!project) return null;

  return (
    <AlephaTable<TaskResource>
      key={project.id}
      defaultSize={25}
      emptyMessage={String(tr("common.noResults"))}
      fetch={async ({ page, size, sort }) =>
        taskApi.getTasks({
          params: { projectId: project.id },
          query: { page, size, sort } as any,
        })
      }
      onRowClick={(task) =>
        router.push("projectTask", {
          params: { taskId: String(task.id) },
        })
      }
      columns={{
        status: {
          label: "Status",
          cell: (task) => {
            const colors: Record<string, string> = {
              new: "bg-blue-500",
              accepted: "bg-orange-500",
              completed: "bg-green-500",
            };
            return (
              <span
                className={`inline-block size-2.5 rounded-full ${colors[task.metadata.status] ?? "bg-muted"}`}
              />
            );
          },
        },
        assignedTo: {
          label: "Assigned",
          cell: (task) =>
            task.acceptedBy ? (
              <div className="flex items-center gap-2">
                {renderAvatar(task.acceptedBy)}
                <span className="text-sm">
                  {users.find((u) => u.id === task.acceptedBy)?.username}
                </span>
              </div>
            ) : (
              <span className="text-muted-foreground">-</span>
            ),
        },
        title: {
          label: "Quest",
          sortable: true,
          cell: (task) => (
            <div className="flex flex-col overflow-hidden whitespace-nowrap">
              <span
                className={`text-sm font-medium ${task.completedAt ? "text-muted-foreground line-through" : ""}`}
              >
                {task.title}
              </span>
              {task.description && (
                <span className="text-muted-foreground truncate text-xs">
                  {removeHtmlTags(task.description.slice(0, 60))}
                </span>
              )}
            </div>
          ),
        },
        priority: {
          label: "Priority",
          sortable: true,
          cell: (task) => (
            <Badge
              variant="secondary"
              className={getPriorityColor(task.priority)}
            >
              {task.priority}
            </Badge>
          ),
        },
        complexity: {
          label: "Rank",
          sortable: true,
          cell: (task) => <TaskComplexity complexity={task.complexity} />,
        },
        package: {
          label: "Zone",
          sortable: true,
          cell: (task) => <span className="text-xs">{task.package}</span>,
        },
        createdAt: {
          label: "Created",
          sortable: true,
          cell: (task) => (
            <span className="text-muted-foreground text-xs">
              {dateFormatter.of(task.createdAt).fromNow()}
            </span>
          ),
        },
        updatedAt: {
          label: "Updated",
          sortable: true,
          cell: (task) => (
            <span className="text-muted-foreground text-xs">
              {dateFormatter.of(task.updatedAt).fromNow()}
            </span>
          ),
        },
      }}
      rowActions={(task) => [
        ...(!task.acceptedAt && taskApi.acceptTask.can()
          ? [
              {
                icon: Signature,
                label: "Accept Quest",
                onClick: async () => {
                  const updated = await taskApi.acceptTask({
                    params: { id: task.id },
                  });
                  alepha.store.set(currentAssignedTasksAtom, [
                    ...(alepha.store.get(currentAssignedTasksAtom) ?? []),
                    updated,
                  ]);
                },
              },
            ]
          : []),
        ...(taskApi.deleteTask.can()
          ? [
              {
                icon: Trash,
                label: "Delete Quest",
                destructive: true,
                onClick: async () => {
                  await taskApi.deleteTask({ params: { id: task.id } });
                },
              },
            ]
          : []),
      ]}
    />
  );
};

export default ProjectBoardTable;
