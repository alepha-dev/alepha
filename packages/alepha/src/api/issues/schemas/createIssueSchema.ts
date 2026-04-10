import type { Static } from "alepha";
import { t } from "alepha";
import { issuePrioritySchema, issueTypeSchema } from "../entities/issues.ts";

export const createIssueSchema = t.object({
  title: t.text({ maxLength: 255 }),
  type: t.optional(issueTypeSchema),
  priority: t.optional(issuePrioritySchema),
  description: t.optional(t.text({ maxLength: 65535 })),
  pageUrl: t.optional(t.string({ format: "uri" })),
});

export type CreateIssue = Static<typeof createIssueSchema>;
