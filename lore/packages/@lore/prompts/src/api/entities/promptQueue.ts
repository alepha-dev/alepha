import { promptJobCauseSchema, projects, users } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * The runs waiting behind a running job of the same prompt and arg values
 * (#Q4354), for a prompt whose concurrency is `queue`.
 *
 * At most ONE per prompt and arg values (the unique index): a run asked for
 * while one already waits adds nothing, since the next run reads the whole
 * set anyway. The running job's end takes the row and starts it.
 *
 * What it keeps is what the run is started with again: the args as given
 * (resolved anew when it starts), where it runs, who asked and why, and the
 * job that raised the event, for the chain guard.
 */
export const promptQueue = $entity({
  name: "prompt_queue",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    prompt: z.string().max(64),
    /**
     * The arg values as the single-flight check compares them, sorted.
     */
    key: z.string().max(2000),
    args: z.record(z.string().max(32), z.string().max(120)).optional(),
    host: z.string().max(64).optional(),
    agent: z.string().max(32).optional(),
    model: z.string().max(96).optional(),
    /**
     * Who asked: the member by hand, the prompt's owner for a trigger.
     * Gone, the waiting run is dropped.
     */
    userId: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    cause: promptJobCauseSchema,
    startedByJobId: z.uuid().optional(),
  }),
  indexes: [{ columns: ["projectId", "prompt", "key"], unique: true }],
});

export type PromptQueueEntry = Infer<typeof promptQueue.schema>;
