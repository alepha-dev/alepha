import { type Infer, z } from "alepha";

/**
 * The `remindersDue` dashboard metric's filters (#Q2655): none.
 */
export const remindersDueFiltersSchema = z.object({});

export type RemindersDueFilters = Infer<typeof remindersDueFiltersSchema>;
