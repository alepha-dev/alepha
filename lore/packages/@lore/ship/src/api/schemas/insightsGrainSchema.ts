import { z } from "alepha";

/**
 * The bucket a timeline is read in.
 */
export const insightsGrainSchema = z.enum(["hour", "day", "week", "month"]);
