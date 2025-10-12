import type { Static } from "@alepha/core";
import { jobExecutions } from "../entities/jobExecutions.ts";

export const jobExecutionResourceSchema = jobExecutions.$schema;

export type JobExecutionResource = Static<typeof jobExecutionResourceSchema>;
