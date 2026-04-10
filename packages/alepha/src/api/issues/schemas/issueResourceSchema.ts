import type { Static } from "alepha";
import { issues } from "../entities/issues.ts";

export const issueResourceSchema = issues.schema;

export type IssueResource = Static<typeof issueResourceSchema>;
