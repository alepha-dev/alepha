import { type Static, t } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";
import { projects } from "./projects.ts";

export const whiteboardElementSchema = t.object({
  id: t.string(),
  type: t.enum(["task", "rect", "circle", "arrow", "text", "line", "image"]),
  x: t.number(),
  y: t.number(),
  width: t.optional(t.number()),
  height: t.optional(t.number()),
  rotation: t.optional(t.number()),
  taskId: t.optional(t.integer()),
  text: t.optional(t.string()),
  points: t.optional(t.array(t.number())),
  stroke: t.optional(t.string()),
  fill: t.optional(t.string()),
  fontSize: t.optional(t.number()),
  strokeWidth: t.optional(t.number()),
  fileId: t.optional(t.uuid()), // For image elements - references uploaded file
});

export const whiteboardDataSchema = t.object({
  elements: t.array(whiteboardElementSchema),
});

export const whiteboards = $entity({
  name: "whiteboards",
  schema: t.object({
    id: db.primaryKey(t.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    deletedAt: db.deletedAt(),
    title: t.string({ minLength: 1, maxLength: 50 }),
    projectId: db.ref(t.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    createdBy: db.ref(t.uuid(), () => users.cols.id, {
      onDelete: "cascade",
    }),
    data: db.default(whiteboardDataSchema, { elements: [] }),
  }),
  indexes: [
    {
      columns: ["projectId", "deletedAt"],
    },
  ],
});

export type Whiteboard = Static<typeof whiteboards.schema>;
export type WhiteboardElement = Static<typeof whiteboardElementSchema>;
export type WhiteboardData = Static<typeof whiteboardDataSchema>;
