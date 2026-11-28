import { z } from "alepha";

/**
 * The dimensions a leaderboard ranks.
 */
export const insightsDimensionSchema = z.enum([
  "path",
  "entry",
  "exit",
  "referrer",
  "campaign",
  "country",
  "device",
  "browser",
  "os",
  "auth",
  "network",
]);
