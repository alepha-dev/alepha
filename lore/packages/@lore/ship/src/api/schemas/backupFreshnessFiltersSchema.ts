import { type Infer, z } from "alepha";

/**
 * The `backupFreshness` dashboard metric's filters (#Q4523): none. Each
 * copy's own schedule decides when its backup is stale, as its Bay says.
 */
export const backupFreshnessFiltersSchema = z.object({});

export type BackupFreshnessFilters = Infer<typeof backupFreshnessFiltersSchema>;
