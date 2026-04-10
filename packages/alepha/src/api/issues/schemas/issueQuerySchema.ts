import type { Static } from "alepha";
import { t } from "alepha";
import { pageQuerySchema } from "alepha/orm";
import {
  issuePrioritySchema,
  issueStatusSchema,
  issueTypeSchema,
} from "../entities/issues.ts";

export const issueQuerySchema = t.extend(pageQuerySchema, {
  status: t.optional(issueStatusSchema),
  type: t.optional(issueTypeSchema),
  priority: t.optional(issuePrioritySchema),
  assigneeId: t.optional(t.uuid({ description: "Filter by assignee" })),
  search: t.optional(t.text({ description: "Search in title" })),
});

export type IssueQuery = Static<typeof issueQuerySchema>;
