import { $module } from "@alepha/core";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./entities/jobExecutions.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides job management API endpoints for Alepha applications.
 *
 * This module includes job queue operations, job status monitoring,
 * and background task management capabilities.
 *
 * @module alepha.api.jobs
 */
export const AlephaApiJobs = $module({
	name: "alepha.api.jobs",
	services: [],
});
