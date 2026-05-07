import { type Static, t } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";
import { campaigns } from "./campaigns.ts";
import { chapters } from "./chapters.ts";

export const quests = $entity({
  name: "quests",
  schema: t.object({
    id: db.primaryKey(t.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    deletedAt: db.deletedAt(),
    title: t.string(),
    description: t.string({ size: "rich" }),
    zone: t.string(),
    priority: t.enum(["optional", "low", "medium", "high"], { mode: "text" }),
    difficulty: t.integer({ minimum: 1, maximum: 5 }),
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
    campaignId: db.ref(t.integer(), () => campaigns.cols.id, {
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
      columns: ["campaignId", "deletedAt"],
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

export type Quest = Static<typeof quests.schema>;
export type QuestUpdate = Static<typeof quests.updateSchema>;
export type QuestInsert = Static<typeof quests.insertSchema>;
