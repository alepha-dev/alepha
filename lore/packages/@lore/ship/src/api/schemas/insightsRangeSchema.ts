import { z } from "alepha";

/**
 * The ranges a request may name: rolling windows ending today (or
 * yesterday), and calendar ones. `custom` is echoed back when the request
 * named `from` and `to` instead.
 */
export const insightsRangeSchema = z.enum([
  "1d",
  "7d",
  "30d",
  "90d",
  "12mo",
  "thisMonth",
  "lastMonth",
  "thisYear",
]);
