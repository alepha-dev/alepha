import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";
import { projects } from "./projects.ts";

export const chapters = $entity({
  name: "chapters",
  schema: t.object({
    id: db.primaryKey(t.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    projectId: db.ref(t.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    number: t.integer({ minimum: 1 }),
    title: t.string({ minLength: 1, maxLength: 100 }),
    description: db.default(t.string({ size: "rich" }), ""),
    closedAt: t.optional(t.datetime()),
  }),
  indexes: [
    { columns: ["projectId"] },
    { columns: ["projectId", "number"], unique: true },
  ],
});

export type Chapter = Static<typeof chapters.schema>;
