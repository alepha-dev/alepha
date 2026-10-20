import type { Infer } from "alepha";
import { z } from "alepha";

/**
 * A fold on the wire: `sum`, `min`, `max` or `last`. See `AnalyticsFold`.
 */
export const analyticsFoldSchema = z.enum(["sum", "min", "max", "last"]);

export type AnalyticsFoldWire = Infer<typeof analyticsFoldSchema>;
