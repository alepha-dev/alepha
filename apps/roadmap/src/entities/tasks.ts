import { type Static, t } from "alepha";
import { users } from "alepha/api/users";
import { $entity, pg } from "alepha/orm";
import { projects } from "./projects.js";

export const tasks = $entity({
  name: "tasks",
  schema: t.object({
    id: pg.primaryKey(t.integer()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),
    deletedAt: pg.deletedAt(),
    title: t.string(),
    description: t.string({ size: "rich" }),
    package: t.string(),
    priority: t.enum(["optional", "low", "medium", "high"]),
    complexity: t.integer({ minimum: 1, maximum: 5 }),
    acceptedAt: t.optional(t.datetime()),
    completedAt: t.optional(t.datetime()),
    objectives: pg.default(
      t.array(
        t.object({
          title: t.string(),
          completed: t.boolean(),
        }),
      ),
      [],
    ),
    projectId: pg.ref(t.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    createdBy: pg.ref(t.uuid(), () => users.cols.id, {
      onDelete: "cascade",
    }),
    acceptedBy: pg.ref(t.optional(t.uuid()), () => users.cols.id, {
      onDelete: "set null",
    }),
    completedBy: pg.ref(t.optional(t.uuid()), () => users.cols.id, {
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
    note: pg.default(t.string({ size: "rich" }), ""),
    timerSessions: pg.default(
      t.array(
        t.object({
          startedAt: t.datetime(),
          stoppedAt: t.optional(t.datetime()),
        }),
      ),
      [],
    ),
  }),
  indexes: [
    {
      columns: ["projectId", "deletedAt"],
    },
  ],
});

export type Task = Static<typeof tasks.schema>;
export type TaskUpdate = Static<typeof tasks.updateSchema>;
export type TaskInsert = Static<typeof tasks.insertSchema>;
