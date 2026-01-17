import { $atom, type Static, t } from "alepha";

const taskVoteSchema = t.object({
  taskId: t.integer(),
  voted: t.boolean(),
  voteCount: t.integer(),
});

export type TaskVote = Static<typeof taskVoteSchema>;

export const taskVotesAtom = $atom({
  name: "task_votes",
  schema: t.optional(t.array(taskVoteSchema)),
});

// Helper to get vote data for a task
export const getTaskVote = (
  votes: TaskVote[] | undefined,
  taskId: number,
): TaskVote | undefined => {
  return votes?.find((v) => v.taskId === taskId);
};

// Helper to update vote data for a task
export const updateTaskVote = (
  votes: TaskVote[] | undefined,
  taskId: number,
  data: Omit<TaskVote, "taskId">,
): TaskVote[] => {
  const existing = votes ?? [];
  const index = existing.findIndex((v) => v.taskId === taskId);
  if (index >= 0) {
    const updated = [...existing];
    updated[index] = { taskId, ...data };
    return updated;
  }
  return [...existing, { taskId, ...data }];
};
