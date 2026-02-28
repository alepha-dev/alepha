import { ActionButton, Flex, Text } from "@alepha/ui";
import { Card } from "@mantine/core";
import { modals } from "@mantine/modals";
import {
  IconCircleFilled,
  IconFileText,
  IconHistory,
  IconPaperclip,
  IconPigMoney,
  IconSignature,
  IconSwords,
  IconTag,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useAlepha, useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useEffect, useState } from "react";
import type { TaskController } from "@/api/controllers/TaskController.ts";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import { CharacterInfo } from "@/api/services/CharacterInfo.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentAssignedTasksAtom } from "@/web/app/atoms/currentAssignedTasksAtom.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { currentProjectCharacterAtom } from "@/web/app/atoms/currentProjectCharacterAtom.ts";
import { currentTaskAtom } from "@/web/app/atoms/currentTaskAtom.ts";
import { theme } from "@/web/app/constants/theme.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import AttachmentBadge from "./AttachmentBadge.tsx";
import TaskDescription from "./TaskDescription.tsx";
import TaskHistory from "./TaskHistory.tsx";
import TaskViewDuplicateButton from "./TaskViewDuplicateButton.tsx";
import TaskViewEditButton from "./TaskViewEditButton.tsx";
import TaskViewNoteButton from "./TaskViewNoteButton.tsx";
import TaskViewObjectives from "./TaskViewObjectives.tsx";
import TaskViewTimer from "./TaskViewTimer.tsx";

export interface TaskViewProps {
  task: TaskResource;
  onClose?: () => void;
  onTaskChange?: (task: TaskResource) => void;
}

const TaskView = (props: TaskViewProps) => {
  const alepha = useAlepha();
  const taskApi = useClient<TaskController>();
  const router = useRouter<AppRouter>();
  const info = useInject(CharacterInfo);
  const { tr } = useI18n<I18n, "en">();
  const [showDialog, setShowDialog] = useState(false);

  const [task, setTask] = useState<TaskResource>(props.task);
  useEffect(() => {
    setTask(props.task);
  }, [props.task]);

  const [project] = useStore(currentProjectAtom);

  const updateTask = (updated: TaskResource) => {
    setTask(updated);
    props.onTaskChange?.(updated);
  };

  const handleClose = () => {
    if (props.onClose) {
      props.onClose();
    } else if (project) {
      router.push("projectBoard", { meta: { deleted: true } });
    }
  };

  const money = info.getMoneyFromTask(task);

  const openDeleteModal = () =>
    new Promise<boolean>((resolve) =>
      modals.openConfirmModal({
        title: tr("task.view.abandon.title"),
        centered: true,
        children: <Text size="sm">{tr("task.view.abandon.confirm")}</Text>,
        onClose: () => resolve(false),
        labels: {
          confirm: tr("task.view.abandon.confirmButton"),
          cancel: tr("common.cancel"),
        },
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
      handleClose();
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
      <Flex direction="column" flex={1} className={"overflow-auto"} gap={0}>
        <Flex direction="column" flex={1} className={"overflow-auto"} gap={0}>
          <Flex
            px={"lg"}
            py={"md"}
            direction={"column"}
            gap={"xl"}
            flex={1}
            className={"overflow-auto"}
          >
            <Flex col gap={"xs"}>
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
                {!task.completedAt && project && (
                  <>
                    <TaskViewEditButton
                      task={task}
                      onUpdate={(it) => {
                        updateTask(it);
                        alepha.store.set(currentTaskAtom, it);
                      }}
                      showDialog={showDialog}
                      setShowDialog={setShowDialog}
                    />
                    <TaskViewNoteButton
                      task={task}
                      onUpdate={(it) => {
                        updateTask(it);
                        alepha.store.set(currentTaskAtom, it);
                      }}
                    />
                    <TaskViewDuplicateButton task={task} />
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
                <TaskViewTimer
                  task={task}
                  onUpdate={(it) => {
                    updateTask(it);
                    alepha.store.set(currentTaskAtom, it);
                    const tasks =
                      alepha.store.get(currentAssignedTasksAtom) ?? [];
                    alepha.store.set(
                      currentAssignedTasksAtom,
                      tasks.map((t) => (t.id === it.id ? it : t)),
                    );
                  }}
                />
                <ActionButton
                  variant={"minimal"}
                  px={"xs"}
                  {...(props.onClose
                    ? { onClick: props.onClose }
                    : project
                      ? {
                          href: router.path("projectBoard", {
                            params: { projectId: String(project.id) },
                          }),
                        }
                      : {})}
                >
                  <IconX size={theme.icon.size.md} />
                </ActionButton>
              </Flex>

              <Text size={"sm"}>
                {tr("task.view.summary", {
                  args: [task.priority, info.getRank(task.complexity)],
                })}
              </Text>
            </Flex>

            <Flex col gap={"xs"}>
              <Flex direction="column" gap={0}>
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
              </Flex>

              <TaskDescription task={task} onEdit={() => setShowDialog(true)} />
            </Flex>

            <TaskViewObjectives
              task={task}
              onTaskUpdate={(updatedTask) => {
                updateTask(updatedTask);
                alepha.store.set(currentTaskAtom, updatedTask);
              }}
            />

            {task.attachments && task.attachments.length > 0 && (
              <>
                <Flex gap={"xs"} align="center" justify="center">
                  <IconPaperclip size={theme.icon.size.lg} />
                  <Text className={"cinzel-400"} size="lg" fw={"bold"}>
                    {tr("task.view.attachments")}
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
                <Flex gap="xs" wrap="wrap">
                  {task.attachments.map((fileId) => (
                    <AttachmentBadge key={fileId} fileId={fileId} disabled />
                  ))}
                </Flex>
              </>
            )}

            <Flex col gap={"xs"}>
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

            {/* History */}
            <Flex col>
              <Flex gap={"xs"} align="center" justify="center">
                <IconHistory size={theme.icon.size.lg} />
                <Text className={"cinzel-400"} size="lg" fw={"bold"}>
                  {tr("task.view.history")}
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
              <TaskHistory task={task} />
            </Flex>
          </Flex>
        </Flex>
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
                  <ActionButton
                    w={"100%"}
                    c={"blue"}
                    variant={"minimal"}
                    leftSection={<IconSignature size={theme.icon.size.md} />}
                    disabled={!taskApi.acceptTask.can()}
                    onClick={async () => {
                      const updatedTask = await taskApi.acceptTask({
                        params: { id: task.id },
                      });
                      updateTask(updatedTask);
                      alepha.store.set(currentTaskAtom, updatedTask);
                      alepha.store.set(currentAssignedTasksAtom, [
                        ...(alepha.store.get(currentAssignedTasksAtom) ?? []),
                        updatedTask,
                      ]);
                    }}
                  >
                    {tr("task.view.actions.accept")}
                  </ActionButton>
                </Flex>
              )}
              {task.acceptedAt && (
                <Flex justify={"space-between"} gap={"xs"}>
                  <Flex>
                    <ActionButton
                      px={"sm"}
                      textVisibleFrom={"sm"}
                      c={"red"}
                      variant={"minimal"}
                      leftSection={<IconTrash size={theme.icon.size.md} />}
                      {...abandonTask}
                    >
                      {tr("task.view.actions.abandon")}
                    </ActionButton>
                  </Flex>
                  <ActionButton
                    c={"green"}
                    variant={"minimal"}
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
                      handleClose();
                    }}
                  >
                    {tr("task.view.actions.complete")}
                  </ActionButton>
                </Flex>
              )}
            </Card>
          </Flex>
        )}
      </Flex>
    </Card>
  );
};

export default TaskView;
