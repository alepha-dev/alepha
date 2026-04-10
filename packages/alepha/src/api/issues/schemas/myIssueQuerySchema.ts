import type { Static } from "alepha";
import { t } from "alepha";
import { pageQuerySchema } from "alepha/orm";
import { issueStatusSchema } from "../entities/issues.ts";

export const myIssueQuerySchema = t.extend(pageQuerySchema, {
  status: t.optional(issueStatusSchema),
});

export type MyIssueQuery = Static<typeof myIssueQuerySchema>;
