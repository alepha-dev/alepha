import { type Static, t } from "@alepha/core";
import type { LogEntry } from "@alepha/logger";

export const devLogEntrySchema = t.object({
	formatted: t.string(),
	entry: t.any(), // Use any since LogEntry has Date instead of string for timestamp
});

export type DevLogEntry = Static<typeof devLogEntrySchema> & {
	entry: LogEntry;
};
