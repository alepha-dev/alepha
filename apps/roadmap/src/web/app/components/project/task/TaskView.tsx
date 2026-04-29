import { Button } from "@alepha/ui/components/ui/button";
import { Card } from "@alepha/ui/components/ui/card";
import { useConfirm } from "@alepha/ui/components/use-confirm";
import { useAlepha, useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  Circle,
  FileText,
  History,
  Paperclip,
  PiggyBank,
  Signature,
  Swords,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { TaskController } from "@/api/controllers/TaskController.ts";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import { CharacterInfo } from "@/api/services/CharacterInfo.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentAssignedTasksAtom } from "@/web/app/atoms/currentAssignedTasksAtom.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { currentProjectCharacterAtom } from "@/web/app/atoms/currentProjectCharacterAtom.ts";
import { currentTaskAtom } from "@/web/app/atoms/currentTaskAtom.ts";
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

interface SectionHeaderProps {
  icon: React.ReactNode;
  label: string;
}

const SectionHeader = (props: SectionHeaderProps) => (
  <div className="flex items-center justify-center gap-2">
    {props.icon}
    <span className="text-lg font-bold">{props.label}</span>
    <div className="bg-border h-px w-full opacity-30" />
  </div>
);

const TaskView = (props: TaskViewProps) => {
  const alepha = useAlepha();
  const taskApi = useClient<TaskController>();
  const router = useRouter<AppRouter>();
  const info = useInject(CharacterInfo);
  const { tr } = useI18n<I18n, "en">();
  const confirm = useConfirm();
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

  const abandonTask = {
    disabled: !taskApi.abandonTask.can(),
    onClick: async () => {
      const ok = await confirm({
        title: String(tr("task.view.abandon.title")),
        description: String(tr("task.view.abandon.confirm")),
        confirmLabel: String(tr("task.view.abandon.confirmButton")),
        cancelLabel: String(tr("common.cancel")),
        destructive: true,
      });
      if (!ok) return;

      const updatedTask = await taskApi.abandonTask({
        params: { id: task.id },
      });
      updateTask(updatedTask);
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
      className="bg-card m-0.5 flex flex-1 flex-col gap-0 overflow-hidden border-border p-0 shadow"
    >
      <div className="flex flex-1 flex-col overflow-auto">
        <div className="flex flex-1 flex-col gap-6 overflow-auto px-5 py-4">
          {/* Title */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-center gap-2">
              <Tag className="size-5" />
              <span className="cinzel-400 whitespace-nowrap text-lg font-bold">
                {task.title}
              </span>
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
              <div className="bg-border h-px flex-1 opacity-30" />
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
              {props.onClose ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={props.onClose}
                >
                  <X className="size-4" />
                </Button>
              ) : project ? (
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                >
                  <Link
                    href={router.path("projectBoard", {
                      params: { projectId: String(project.id) },
                    })}
                  >
                    <X className="size-4" />
                  </Link>
                </Button>
              ) : null}
            </div>
            <span className="text-sm">
              {tr("task.view.summary", {
                args: [task.priority, info.getRank(task.complexity)],
              })}
            </span>
          </div>

          {/* Description */}
          <div className="flex flex-col gap-2">
            <SectionHeader
              icon={<FileText className="size-5" />}
              label={String(tr("task.view.description"))}
            />
            <TaskDescription task={task} onEdit={() => setShowDialog(true)} />
          </div>

          {/* Objectives */}
          <TaskViewObjectives
            task={task}
            onTaskUpdate={(updatedTask) => {
              updateTask(updatedTask);
              alepha.store.set(currentTaskAtom, updatedTask);
            }}
          />

          {/* Attachments */}
          {task.attachments && task.attachments.length > 0 && (
            <div className="flex flex-col gap-2">
              <SectionHeader
                icon={<Paperclip className="size-5" />}
                label={String(tr("task.view.attachments"))}
              />
              <div className="flex flex-wrap gap-2">
                {task.attachments.map((fileId) => (
                  <AttachmentBadge key={fileId} fileId={fileId} disabled />
                ))}
              </div>
            </div>
          )}

          {/* Rewards */}
          <div className="flex flex-col gap-2">
            <SectionHeader
              icon={<PiggyBank className="size-5" />}
              label={String(tr("task.view.rewards"))}
            />
            <div className="flex items-center gap-2">
              <span className="text-sm">{tr("task.view.receive")}</span>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 text-sm">
                  {info.getGold(money)}
                  <Circle
                    className="size-3"
                    fill="var(--color-gold)"
                    color="var(--color-gold)"
                  />
                </span>
                <span className="flex items-center gap-1 text-sm">
                  {info.getSilver(money)}
                  <Circle
                    className="size-3"
                    fill="var(--color-silver)"
                    color="var(--color-silver)"
                  />
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm">{tr("task.view.experience")}</span>
              <span className="text-sm font-bold">
                {info.getXpFromTask(task)} XP
              </span>
            </div>
          </div>

          {/* History */}
          <div className="flex flex-col gap-2">
            <SectionHeader
              icon={<History className="size-5" />}
              label={String(tr("task.view.history"))}
            />
            <TaskHistory task={task} />
          </div>
        </div>

        {!task.completedAt && (
          <div className="p-2">
            <Card className="bg-muted border-border w-full rounded-md p-2 shadow">
              {!task.acceptedAt && (
                <div className="flex flex-1 justify-center">
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full text-blue-500 hover:text-blue-600"
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
                    <Signature className="size-4" />
                    {tr("task.view.actions.accept")}
                  </Button>
                </div>
              )}
              {task.acceptedAt && (
                <div className="flex justify-between gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-red-500 hover:text-red-600"
                    {...abandonTask}
                  >
                    <Trash2 className="size-4" />
                    <span className="hidden sm:inline">
                      {tr("task.view.actions.abandon")}
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-green-600 hover:text-green-700"
                    disabled={
                      !taskApi.completeTask.can() ||
                      task.objectives.some((o) => !o.completed)
                    }
                    onClick={async () => {
                      const { character, ...updatedTask } =
                        await taskApi.completeTask({
                          params: { id: task.id },
                        });
                      updateTask(updatedTask);
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
                    <Swords className="size-4" />
                    {tr("task.view.actions.complete")}
                  </Button>
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </Card>
  );
};

export default TaskView;
