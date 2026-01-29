import { ActionButton } from "@alepha/ui";
import {
  ActionIcon,
  Badge,
  Card,
  Flex,
  Loader,
  Menu,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconChevronDown,
  IconChevronUp,
  IconDots,
  IconSearch,
  IconSignature,
  IconTrash,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import { DateTimeProvider } from "alepha/datetime";
import type { Page } from "alepha/orm";
import { useClient, useInject, useStore } from "alepha/react";
import { useRouter } from "alepha/react/router";
import { useEffect, useState } from "react";
import type { ProjectController } from "../../../../api/controllers/ProjectController.ts";
import type { TaskController } from "../../../../api/controllers/TaskController.ts";
import type { Task } from "../../../../api/entities/tasks.ts";
import type { User } from "../../../../api/entities/users.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { theme } from "../../constants/theme.ts";
import TaskComplexity from "./task/TaskComplexity.tsx";

type TaskStatus = "new" | "accepted" | "completed";

const ProjectBoard = () => {
  const [project] = useStore(currentProjectAtom);
  const taskApi = useClient<TaskController>();
  const projectApi = useClient<ProjectController>();
  const [status, setStatus] = useState<TaskStatus>("new");
  const [result, setResult] = useState<Page<Task> | undefined>();
  const dateFormatter = useInject(DateTimeProvider);
  const [loading, setLoading] = useState(false);
  const router = useRouter<AppRouter>();
  const next =
    result && !result.page.isLast ? result.page.number + 1 : undefined;
  const tasks = result?.content || [];
  const [sortValue, setSortValue] = useState<string | undefined>(undefined);
  const [searchValue, setSearchValue] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [users, setUsers] = useState<Array<User>>([]);

  const loadUsers = async () => {
    if (!project?.id) return;

    setUsers(
      await projectApi.getProjectUsers({
        params: { id: project.id },
      }),
    );
  };

  const loadTasks = async () => {
    if (!project?.id) return;

    setSortValue(undefined);
    setLoading(true);
    try {
      const result = await taskApi.getTasks({
        params: { projectId: project.id },
        query: {
          size: 100,
          status,
          search: searchQuery || undefined,
        },
      });
      setResult(result);
    } catch (error) {
      console.error("Error loading tasks:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers().catch(() => null);
  }, [project?.id]);

  useEffect(() => {
    loadTasks().catch(() => null);
  }, [project?.id, status, searchQuery]);

  const actions = {
    acceptTask: {
      can: () => taskApi.acceptTask.can(),
      onClick: async () => {},
    },
    deleteTask: (id: number) => ({
      can: () => taskApi.deleteTask.can(),
      onClick: async () => {
        await taskApi.deleteTask({
          params: { id },
        });
        await loadTasks();
      },
    }),
    sortBy: (key: string) => ({
      onClick: async () => {
        if (!project?.id) return;

        const sort =
          sortValue === `${key}`
            ? `-${key}`
            : sortValue === `-${key}`
              ? undefined
              : `${key}`;

        const result = await taskApi.getTasks({
          params: { projectId: project.id },
          query: {
            status,
            sort,
            search: searchQuery || undefined,
          },
        });

        setResult(result);
        setSortValue(sort);
      },
    }),
    more: {
      onClick: async () => {
        if (!project?.id) return;

        const more = await taskApi.getTasks({
          params: { projectId: project.id },
          query: {
            status,
            page: next,
            search: searchQuery || undefined,
          },
        });

        setResult({
          ...more,
          content: [...tasks, ...more.content],
        });
      },
    },
  };

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchValue(event.currentTarget.value);
  };

  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setSearchQuery(searchValue.trim());
  };

  const handleClearSearch = () => {
    setSearchValue("");
    setSearchQuery("");
  };

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

  const renderAvatar = (userId?: string) => {
    if (userId) {
      const user = users.find((u) => u.id === userId);
      if (user) {
        if (user.picture) {
          return (
            <img
              alt={"user avatar"}
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
    }
    return <IconUser />;
  };

  const removeHtmlTags = (text: string) => {
    return text.replace(/<[^>]*>/g, "");
  };

  const getSortIcon = (key: string) => {
    if (sortValue === key) {
      return <IconChevronUp size={theme.icon.size.xs} />;
    } else if (sortValue === `-${key}`) {
      return <IconChevronDown size={theme.icon.size.xs} />;
    }
    return null;
  };

  return (
    <Stack flex={1} gap="md" className="overflow-auto">
      <Card withBorder p={0} flex={1}>
        <Card
          p={0}
          withBorder
          radius={0}
          style={{
            borderRight: 0,
            borderLeft: 0,
            borderTop: 0,
          }}
        >
          <Flex justify="space-between" align="center" p={"sm"}>
            <Flex
              visibleFrom={"sm"}
              gap={"xs"}
              justify={"center"}
              align={"center"}
            >
              <Text fw={400} size="lg"></Text>
            </Flex>
            <Flex gap={"sm"} align={"center"}>
              <form onSubmit={handleSearchSubmit}>
                <TextInput
                  value={searchValue}
                  onChange={handleSearchChange}
                  placeholder="Search quests..."
                  size={"xs"}
                  leftSection={<IconSearch size={theme.icon.size.xs} />}
                  rightSection={
                    searchQuery && (
                      <ActionIcon
                        size="xs"
                        variant="subtle"
                        onClick={handleClearSearch}
                        color="gray"
                      >
                        <IconX size={theme.icon.size.xs} />
                      </ActionIcon>
                    )
                  }
                />
              </form>
              <SegmentedControl
                disabled={loading}
                size={"xs"}
                value={status}
                onChange={(value) => setStatus(value as TaskStatus)}
                data={[
                  { label: "New", value: "new" },
                  { label: "Accepted", value: "accepted" },
                  { label: "Completed", value: "completed" },
                ]}
              />
            </Flex>
          </Flex>
        </Card>

        {loading ? (
          <Flex flex={1} align={"center"} justify={"center"}>
            <Loader type={"dots"} />
          </Flex>
        ) : tasks.length === 0 ? (
          <Card w={"100%"} p={"md"} c="dimmed" flex={1}>
            <Flex flex={1} align={"center"} justify={"center"}>
              <Text c="dimmed">No {status} quests found</Text>
            </Flex>
          </Card>
        ) : (
          <Card flex={1} p={0} className="overflow-auto">
            <Table stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  {status === "accepted" && (
                    <Table.Th>
                      <ActionButton
                        h={"auto"}
                        p={"xs"}
                        {...actions.sortBy("assignedAt")}
                      >
                        <Flex align="center" gap={4}>
                          <Text size="sm">Assigned</Text>
                          {getSortIcon("assignedAt")}
                        </Flex>
                      </ActionButton>
                    </Table.Th>
                  )}
                  <Table.Th>
                    <ActionButton
                      h={"auto"}
                      p={"xs"}
                      {...actions.sortBy("title")}
                    >
                      <Flex align="center" gap={4}>
                        <Text size="sm">Quest</Text>
                        {getSortIcon("title")}
                      </Flex>
                    </ActionButton>
                  </Table.Th>
                  <Table.Th>
                    <ActionButton
                      h={"auto"}
                      p={"xs"}
                      {...actions.sortBy("priority")}
                    >
                      <Flex align="center" gap={4}>
                        <Text size="sm">Priority</Text>
                        {getSortIcon("priority")}
                      </Flex>
                    </ActionButton>
                  </Table.Th>
                  <Table.Th>
                    <ActionButton
                      h={"auto"}
                      p={"xs"}
                      {...actions.sortBy("complexity")}
                    >
                      <Flex align="center" gap={4}>
                        <Text size="sm">Rank</Text>
                        {getSortIcon("complexity")}
                      </Flex>
                    </ActionButton>
                  </Table.Th>
                  <Table.Th>
                    <ActionButton
                      h={"auto"}
                      p={"xs"}
                      {...actions.sortBy("package")}
                    >
                      <Flex align="center" gap={4}>
                        <Text size="sm">Zone</Text>
                        {getSortIcon("package")}
                      </Flex>
                    </ActionButton>
                  </Table.Th>
                  <Table.Th>
                    <ActionButton
                      h={"auto"}
                      p={"xs"}
                      {...actions.sortBy(
                        status === "completed" ? "completedAt" : "createdAt",
                      )}
                    >
                      <Flex align="center" gap={4}>
                        <Text size="sm">
                          {status === "completed" ? "Completed" : "Created"}
                        </Text>
                        {getSortIcon(
                          status === "completed" ? "completedAt" : "createdAt",
                        )}
                      </Flex>
                    </ActionButton>
                  </Table.Th>
                  <Table.Th></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {tasks.map((task) => (
                  <Table.Tr key={task.id}>
                    {status === "accepted" && (
                      <Table.Td align={"center"}>
                        {renderAvatar(task.acceptedBy)}
                      </Table.Td>
                    )}
                    <Table.Td maw={"254px"}>
                      <ActionButton
                        w={"100%"}
                        px={"xs"}
                        justify={"start"}
                        href={router.path("projectTask", {
                          params: {
                            taskId: task.id,
                          },
                        })}
                        routerGoOptions={{
                          meta: { transition: "fadeInUp" },
                        }}
                      >
                        <Flex
                          direction={"column"}
                          align={"start"}
                          flex={1}
                          style={{
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                          }}
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
                            <Text
                              style={{ textOverflow: "ellipsis" }}
                              size="xs"
                              c="dimmed"
                            >
                              {removeHtmlTags(task.description.slice(0, 100))}
                            </Text>
                          )}
                        </Flex>
                      </ActionButton>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        size="sm"
                        color={getPriorityColor(task.priority)}
                        variant="light"
                      >
                        {task.priority}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <TaskComplexity complexity={task.complexity} />
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{task.package}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {dateFormatter
                          .of(task.completedAt ?? task.createdAt)
                          .fromNow()}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Menu
                        position="right"
                        withArrow
                        trigger={"click"}
                        arrowSize={12}
                        transitionProps={{
                          transition: "fade-right",
                          duration: 200,
                        }}
                      >
                        <Menu.Target>
                          <ActionButton px={"xs"} variant="subtle" size="xs">
                            <IconDots size={theme.icon.size.sm} />
                          </ActionButton>
                        </Menu.Target>
                        <Menu.Dropdown>
                          {!task.acceptedAt && (
                            <Menu.Item
                              variant={"light"}
                              color="blue"
                              leftSection={
                                <IconSignature size={theme.icon.size.xs} />
                              }
                            >
                              Accept Quest
                            </Menu.Item>
                          )}
                          {!task.acceptedAt && <Menu.Divider />}
                          <Menu.Item
                            color="red"
                            {...actions.deleteTask(task.id)}
                            leftSection={
                              <IconTrash size={theme.icon.size.xs} />
                            }
                          >
                            Delete Quest
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {next && (
              <Flex p={"md"} justify={"center"} align={"center"}>
                <ActionButton variant="subtle" size="xs" {...actions.more}>
                  Load More
                </ActionButton>
              </Flex>
            )}
          </Card>
        )}
      </Card>
    </Stack>
  );
};

export default ProjectBoard;
