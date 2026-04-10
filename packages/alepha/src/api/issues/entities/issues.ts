import { type Static, t } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

export const issueTypeSchema = t.enum(["bug", "feature", "improvement"], {
  default: "bug",
});

export const issuePrioritySchema = t.enum(["low", "medium", "high", "urgent"], {
  default: "medium",
});

export const issueStatusSchema = t.enum([
  "open",
  "assigned",
  "completed",
  "archived",
]);

export const issues = $entity({
  name: "issues",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    createdBy: db.ref(t.uuid(), () => users.cols.id, { onDelete: "cascade" }),
    title: t.text({ maxLength: 255 }),
    type: db.default(issueTypeSchema, "bug"),
    priority: db.default(issuePrioritySchema, "medium"),
    status: db.default(issueStatusSchema, "open"),
    description: t.optional(t.text({ maxLength: 65535 })),
    pageUrl: t.optional(t.string({ format: "uri" })),
    assigneeId: t.optional(db.ref(t.uuid(), () => users.cols.id)),
    assignedAt: t.optional(t.datetime()),
    resolution: t.optional(t.text({ maxLength: 65535 })),
    completedAt: t.optional(t.datetime()),
    reopenReason: t.optional(t.text({ maxLength: 1024 })),
    archivedAt: t.optional(t.datetime()),
  }),
  indexes: [
    "status",
    "createdBy",
    "assigneeId",
    { columns: ["type", "status"] },
  ],
});

export type IssueEntity = Static<typeof issues.schema>;
