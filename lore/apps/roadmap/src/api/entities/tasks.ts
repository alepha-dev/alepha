import { type Static, t } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";
import { chapters } from "./chapters.ts";
import { projects } from "./projects.ts";

export const tasks = $entity({
  name: "tasks",
  schema: t.object({
    id: db.primaryKey(t.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    deletedAt: db.deletedAt(),
    title: t.string(),
    description: t.string({ size: "rich" }),
    package: t.string(),
    priority: t.enum(["optional", "low", "medium", "high"], { mode: "text" }),
    complexity: t.integer({ minimum: 1, maximum: 5 }),
    acceptedAt: t.optional(t.datetime()),
    completedAt: t.optional(t.datetime()),
    objectives: db.default(
      t.array(
        t.object({
          title: t.string(),
          completed: t.boolean(),
        }),
      ),
      [],
    ),
    projectId: db.ref(t.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    chapterId: db.ref(t.optional(t.integer()), () => chapters.cols.id, {
      onDelete: "set null",
    }),
    createdBy: db.ref(t.uuid(), () => users.cols.id, {
      onDelete: "cascade",
    }),
    acceptedBy: db.ref(t.optional(t.uuid()), () => users.cols.id, {
      onDelete: "set null",
    }),
    completedBy: db.ref(t.optional(t.uuid()), () => users.cols.id, {
      onDelete: "set null",
    }),
    history: t.array(
      t.object({
        at: t.datetime(),
        by: t.uuid(),
        action: t.enum([
          "updated",
          "assigned",
          "unassigned",
          "objective_completed",
        ]),
      }),
      { default: [] },
    ),
    note: db.default(t.string({ size: "rich" }), ""),
    timerSessions: db.default(
      t.array(
        t.object({
          startedAt: t.datetime(),
          stoppedAt: t.optional(t.datetime()),
        }),
      ),
      [],
    ),
    attachments: db.default(t.array(t.uuid()), []),
  }),
  indexes: [
    {
      columns: ["projectId", "deletedAt"],
    },
    {
      columns: ["acceptedBy"],
    },
    {
      columns: ["completedBy"],
    },
    {
      columns: ["chapterId"],
    },
  ],
});

export type Task = Static<typeof tasks.schema>;
export type TaskUpdate = Static<typeof tasks.updateSchema>;
export type TaskInsert = Static<typeof tasks.insertSchema>;
