import {
  ClientOnly,
  useAlepha,
  useClient,
  useInject,
  useRouter,
  useStore,
} from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { Card, Drawer, Flex, Stack, Text, Textarea } from "@mantine/core";
import { modals } from "@mantine/modals";
import {
  IconCircleFilled,
  IconClock,
  IconCopy,
  IconEdit,
  IconFileText,
  IconNotes,
  IconPigMoney,
  IconPlayerPause,
  IconPlayerPlay,
  IconSignature,
  IconSwords,
  IconTag,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { TaskController } from "../../../../api/controllers/TaskController.ts";
import type { Task } from "../../../../api/entities/tasks.ts";
import { CharacterInfo } from "../../../../api/services/CharacterInfo.ts";
import type { AppRouter } from "../../../AppRouter.ts";
import { currentAssignedTasksAtom } from "../../../atoms/currentAssignedTasksAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentProjectCharacterAtom } from "../../../atoms/currentProjectCharacterAtom.ts";
import { currentTaskAtom } from "../../../atoms/currentTaskAtom.ts";
import { theme } from "../../../constants/theme.ts";
import type { I18n } from "../../../services/I18n.ts";
import Action from "../../ui/Action.jsx";
import TaskCreate from "./TaskCreate.jsx";
import TaskDescription from "./TaskDescription.jsx";
import TaskViewObjectives from "./TaskViewObjectives.jsx";

export interface TaskViewProps {
  task: Task;
}

const TaskView = (props: TaskViewProps) => {
  const alepha = useAlepha();
  const taskApi = useClient<TaskController>();
  const router = useRouter<AppRouter>();
  const info = useInject(CharacterInfo);
  const { tr } = useI18n<I18n, "en">();
  const [showDialog, setShowDialog] = useState(false);

  const [task, setTask] = useState<Task>(props.task);
  useEffect(() => {
    setTask(props.task);
  }, [props.task]);

  const [project] = useStore(currentProjectAtom);
  if (!project) {
    return null;
  }

  const money = info.getMoneyFromTask(task);

  const openDeleteModal = () =>
    new Promise<boolean>((resolve) =>
      modals.openConfirmModal({
        title: "Abandon the quest",
        centered: true,
        children: (
          <Text size="sm">
            Are you sure you want to abandon this quest? You will lose all
            progress on this task.
          </Text>
        ),
        onClose: () => resolve(false),
        labels: { confirm: "Abandon Quest", cancel: "Cancel" },
        confirmProps: { color: "red" },
        onCancel: () => resolve(false),
        onConfirm: () => resolve(true),
      }),
    );

  const abandonTask = {
    disabled: !taskApi.abandonTask.can(),
    onClick: async () => {
      const confirm = await openDeleteModal();
      if (!confirm) {
        return;
      }

      await taskApi.abandonTask({
        params: { id: task.id },
      });

      alepha.store.set(
        currentAssignedTasksAtom,
        (alepha.store.get(currentAssignedTasksAtom) ?? []).filter(
          (t) => t.id !== task.id,
        ),
      );
      await router.go("projectBoard", {
        meta: {
          deleted: true,
        },
      });
    },
  };

  return (
    <Card
      key={task.id}
      flex={1}
      withBorder
      className={"shadow"}
      bg={theme.colors.card}
      p={0}
      m={2}
    >
      <Stack flex={1} className={"overflow-auto"} gap={0}>
        <Stack flex={1} className={"overflow-auto"} gap={0}>
          <Flex
            px={"lg"}
            py={"md"}
            direction={"column"}
            gap={"md"}
            flex={1}
            className={"overflow-auto"}
          >
            <Flex gap={"xs"} align="center" justify="center">
              <IconTag size={theme.icon.size.md} />
              <Text
                size="lg"
                fw={"bold"}
                style={{ textWrap: "nowrap" }}
                className={"cinzel-400"}
              >
                {task.title}
              </Text>
              {!task.completedAt && (
                <>
                  <EditTaskButton
                    task={task}
                    onUpdate={(it) => {
                      setTask(it);
                      alepha.store.set(currentTaskAtom, it);
                    }}
                    showDialog={showDialog}
                    setShowDialog={setShowDialog}
                  />
                  <NoteButton
                    task={task}
                    onUpdate={(it) => {
                      setTask(it);
                      alepha.store.set(currentTaskAtom, it);
                    }}
                  />
                  <DuplicateTaskButton task={task} />
                </>
              )}
              <Flex
                flex={1}
                style={{
                  opacity: 0.1,
                  height: 1,
                  backgroundColor: "var(--alepha-text)",
                }}
              />
              <TaskTimer
                task={task}
                onUpdate={(it) => {
                  setTask(it);
                  alepha.store.set(currentTaskAtom, it);
                  const tasks =
                    alepha.store.get(currentAssignedTasksAtom) ?? [];
                  alepha.store.set(
                    currentAssignedTasksAtom,
                    tasks.map((t) => (t.id === it.id ? it : t)),
                  );
                }}
              />
              <Action
                px={"xs"}
                href={router.path("projectBoard", {
                  params: { projectId: String(project.id) },
                })}
              >
                <IconX size={theme.icon.size.md} />
              </Action>
            </Flex>
            <Text size={"sm"}>
              {tr("task.view.summary", {
                args: [task.priority, info.getRank(task.complexity)],
              })}
            </Text>

            <Stack gap={0}>
              <Flex gap={"xs"} align="center" justify="center">
                <IconFileText size={theme.icon.size.lg} />
                <Text size="lg" fw={"bold"} className={"cinzel-400"}>
                  {tr("task.view.description")}
                </Text>
                <Flex
                  w={"100%"}
                  style={{
                    opacity: 0.1,
                    height: 1,
                    backgroundColor: "var(--alepha-text)",
                  }}
                />
              </Flex>
            </Stack>

            <TaskDescription task={task} onEdit={() => setShowDialog(true)} />

            <TaskViewObjectives
              task={task}
              onTaskUpdate={(updatedTask) => {
                setTask(updatedTask);
                alepha.store.set(currentTaskAtom, updatedTask);
              }}
            />

            <Flex gap={"xs"} align="center" justify="center">
              <IconPigMoney size={theme.icon.size.lg} />
              <Text className={"cinzel-400"} size="lg" fw={"bold"}>
                {tr("task.view.rewards")}
              </Text>
              <Flex
                w={"100%"}
                style={{
                  opacity: 0.1,
                  height: 1,
                  backgroundColor: "var(--alepha-text)",
                }}
              />
            </Flex>
            <Flex gap={"sm"}>
              <Text size={"sm"}>{tr("task.view.receive")}</Text>
              <Flex gap={"xs"} align={"center"}>
                <Flex align={"center"} gap={2}>
                  <Text size={"sm"}>{info.getGold(money)}</Text>
                  <IconCircleFilled
                    color={"var(--color-gold)"}
                    size={theme.icon.size.xs}
                  />
                </Flex>
                <Flex align={"center"} gap={2}>
                  <Text size={"sm"}>{info.getSilver(money)}</Text>
                  <IconCircleFilled
                    color={"var(--color-silver)"}
                    size={theme.icon.size.xs}
                  />
                </Flex>
              </Flex>
            </Flex>
            <Flex gap={"sm"}>
              <Text size={"sm"}>{tr("task.view.experience")}</Text>
              <Text size={"sm"} fw={"bold"}>
                {info.getXpFromTask(task)} XP
              </Text>
            </Flex>
          </Flex>
        </Stack>
        {!task.completedAt && (
          <Flex p={"xs"}>
            <Card
              w={"100%"}
              p={"xs"}
              bg={theme.colors.panel}
              withBorder
              radius={"md"}
              className={"shadow"}
            >
              {!task.acceptedAt && (
                <Flex justify={"center"} flex={1}>
                  <Action
                    w={"100%"}
                    c={"blue"}
                    variant={"subtle"}
                    leftSection={<IconSignature size={theme.icon.size.md} />}
                    disabled={!taskApi.acceptTask.can()}
                    onClick={async () => {
                      const updatedTask = await taskApi.acceptTask({
                        params: { id: task.id },
                      });
                      setTask(updatedTask);
                      alepha.store.set(currentTaskAtom, updatedTask);
                      alepha.store.set(currentAssignedTasksAtom, [
                        ...(alepha.store.get(currentAssignedTasksAtom) ?? []),
                        updatedTask,
                      ]);
                    }}
                  >
                    {tr("task.view.actions.accept")}
                  </Action>
                </Flex>
              )}
              {task.acceptedAt && (
                <Flex justify={"space-between"} gap={"xs"}>
                  <Flex>
                    <Action
                      px={"sm"}
                      textVisibleFrom={"sm"}
                      c={"red"}
                      variant={"subtle"}
                      leftSection={<IconTrash size={theme.icon.size.md} />}
                      {...abandonTask}
                    >
                      {tr("task.view.actions.abandon")}
                    </Action>
                  </Flex>
                  <Action
                    c={"green"}
                    variant={"subtle"}
                    leftSection={<IconSwords size={theme.icon.size.md} />}
                    disabled={
                      !taskApi.completeTask.can() ||
                      task.objectives.some((o) => !o.completed)
                    }
                    onClick={async () => {
                      const { character } = await taskApi.completeTask({
                        params: { id: task.id },
                      });
                      alepha.store.set(currentProjectCharacterAtom, character);
                      alepha.store.set(
                        currentAssignedTasksAtom,
                        (
                          alepha.store.get(currentAssignedTasksAtom) ?? []
                        ).filter((t) => t.id !== task.id),
                      );
                      await router.go("projectBoard", {
                        meta: {
                          completed: true,
                        },
                      });
                    }}
                  >
                    {tr("task.view.actions.complete")}
                  </Action>
                </Flex>
              )}
            </Card>
          </Flex>
        )}
      </Stack>
    </Card>
  );
};

export default TaskView;

const EditTaskButton = (props: {
  task: Task;
  onUpdate: (task: Task) => void;
  setShowDialog?: (show: boolean) => void;
  showDialog?: boolean;
}) => {
  const { showDialog = false, setShowDialog = () => {} } = props;

  const client = useClient<TaskController>();
  const [project] = useStore(currentProjectAtom);
  if (!project) {
    return null;
  }

  if (!client.updateTaskById.can()) {
    return null;
  }

  return (
    <Flex>
      <Action
        px={"xs"}
        variant={"subtle"}
        onClick={() => {
          setShowDialog(true);
        }}
      >
        <IconEdit size={theme.icon.size.md} />
      </Action>
      <Drawer
        title={"Update Quest"}
        size={"xl"}
        position={"right"}
        opened={showDialog}
        onClose={() => setShowDialog(false)}
        className={"drawer"}
      >
        <Card
          withBorder
          bg={theme.colors.card}
          radius={"md"}
          className={"shadow"}
        >
          <TaskCreate
            project={project}
            task={props.task}
            onSubmit={(task) => {
              setShowDialog(false);
              props.onUpdate(task);
            }}
          />
        </Card>
      </Drawer>
    </Flex>
  );
};

const NoteButton = (props: { task: Task; onUpdate: (task: Task) => void }) => {
  const [showDialog, setShowDialog] = useState(false);
  const [noteText, setNoteText] = useState(props.task.note || "");
  const client = useClient<TaskController>();
  const alepha = useAlepha();

  if (!client.updateTaskNote.can()) {
    return null;
  }

  const handleSave = async () => {
    const updatedTask = await client.updateTaskNote({
      params: { id: props.task.id },
      body: { note: noteText },
    });
    props.onUpdate(updatedTask);
    // Update local state
    const currentTasks = alepha.store.get(currentAssignedTasksAtom) || [];
    const updatedTasks = currentTasks.map((t) =>
      t.id === updatedTask.id ? updatedTask : t,
    );
    alepha.store.set(currentAssignedTasksAtom, updatedTasks);
    setShowDialog(false);
  };

  return (
    <Flex>
      <Action
        px={"xs"}
        variant={"subtle"}
        onClick={() => {
          setNoteText(props.task.note || "");
          setShowDialog(true);
        }}
      >
        <IconNotes size={theme.icon.size.md} />
      </Action>
      <Drawer
        title={"Quest Notes"}
        size={"xl"}
        position={"right"}
        opened={showDialog}
        onClose={() => setShowDialog(false)}
        className={"drawer"}
      >
        <Card
          withBorder
          bg={theme.colors.card}
          radius={"md"}
          className={"shadow"}
          p={"md"}
        >
          <Stack gap={"md"}>
            <Textarea
              placeholder="Add your notes here..."
              value={noteText}
              onChange={(e) => setNoteText(e.currentTarget.value)}
              minRows={10}
              autosize
            />
            <Flex justify={"flex-end"} gap={"sm"}>
              <Action variant={"subtle"} onClick={() => setShowDialog(false)}>
                Cancel
              </Action>
              <Action variant={"filled"} onClick={handleSave}>
                Save
              </Action>
            </Flex>
          </Stack>
        </Card>
      </Drawer>
    </Flex>
  );
};

const DuplicateTaskButton = (props: { task: Task }) => {
  const [showDialog, setShowDialog] = useState(false);
  const client = useClient<TaskController>();
  const [project] = useStore(currentProjectAtom);

  if (!project) {
    return null;
  }

  if (!client.createTask.can()) {
    return null;
  }

  // Prepare duplicate task data (exclude id and timestamps)
  const duplicateTaskData = {
    title: `${props.task.title} (Copy)`,
    description: props.task.description,
    package: props.task.package,
    priority: props.task.priority,
    complexity: props.task.complexity,
    objectives: props.task.objectives.map((obj) => ({
      title: obj.title,
      completed: false, // Reset completion status for duplicate
    })),
  };

  return (
    <Flex>
      <Action
        px={"xs"}
        variant={"subtle"}
        onClick={() => {
          setShowDialog(true);
        }}
      >
        <IconCopy size={theme.icon.size.md} />
      </Action>
      <Drawer
        title={"Duplicate Quest"}
        size={"xl"}
        position={"right"}
        opened={showDialog}
        onClose={() => setShowDialog(false)}
        className={"drawer"}
      >
        <Card
          withBorder
          bg={theme.colors.card}
          radius={"md"}
          className={"shadow"}
        >
          <TaskCreate
            project={project}
            task={duplicateTaskData as Task}
            onSubmit={() => {
              setShowDialog(false);
            }}
          />
        </Card>
      </Drawer>
    </Flex>
  );
};

const TaskTimer = (props: { task: Task; onUpdate: (task: Task) => void }) => {
  const client = useClient<TaskController>();
  const [currentTime, setCurrentTime] = useState<number>(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const { task } = props;

  // Calculate total time from all sessions
  const calculateTotalTime = () => {
    if (!task.timerSessions) return 0;

    let total = 0;
    const now = new Date();

    for (const session of task.timerSessions) {
      const start = new Date(session.startedAt);
      const stop = session.stoppedAt ? new Date(session.stoppedAt) : now;
      total += stop.getTime() - start.getTime();
    }

    return Math.floor(total / 1000); // Return in seconds
  };

  // Check if timer is running
  const isTimerRunning = () => {
    if (!task.timerSessions || task.timerSessions.length === 0) return false;
    const lastSession = task.timerSessions[task.timerSessions.length - 1];
    return lastSession && !lastSession.stoppedAt;
  };

  // Format time display
  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    }
    return `${secs}s`;
  };

  // Start/stop timer
  const toggleTimer = async () => {
    if (isTimerRunning()) {
      const updatedTask = await client.stopTimer({
        params: { id: task.id },
      });
      props.onUpdate(updatedTask);

      // Clear interval
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    } else {
      const updatedTask = await client.startTimer({
        params: { id: task.id },
      });
      props.onUpdate(updatedTask);
    }
  };

  // Update timer display
  useEffect(() => {
    // Set initial time
    setCurrentTime(calculateTotalTime());

    // If timer is running, update every second
    if (isTimerRunning()) {
      intervalRef.current = setInterval(() => {
        setCurrentTime(calculateTotalTime());
      }, 1000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [task.timerSessions]);

  // Don't show timer if task is not accepted or already completed
  if (!task.acceptedAt || task.completedAt) {
    return null;
  }

  // Don't show if user doesn't have permission
  if (!client.startTimer.can() && !client.stopTimer.can()) {
    return null;
  }

  const running = isTimerRunning();

  return (
    <Flex align="center">
      <Flex
        className={"shadow"}
        align="center"
        gap="xs"
        ml={"xs"}
        px={"xs"}
        py={2}
        bdrs={"md"}
        miw={150}
        justify={"end"}
        bd={"1px solid var(--alepha-border)"}
      >
        <IconClock size={theme.icon.size.sm} opacity={0.6} />
        <ClientOnly>
          <Text size="sm" fw={500}>
            {formatTime(currentTime)}
          </Text>
        </ClientOnly>
        <Action
          px={"xs"}
          variant={"subtle"}
          onClick={toggleTimer}
          disabled={!client.startTimer.can() && !client.stopTimer.can()}
        >
          {running ? (
            <IconPlayerPause size={theme.icon.size.md} />
          ) : (
            <IconPlayerPlay size={theme.icon.size.md} />
          )}
        </Action>
      </Flex>

      <Flex
        flex={1}
        ml={"xs"}
        style={{
          width: 32,
          opacity: 0.1,
          height: 1,
          backgroundColor: "var(--alepha-text)",
        }}
      />
    </Flex>
  );
};
