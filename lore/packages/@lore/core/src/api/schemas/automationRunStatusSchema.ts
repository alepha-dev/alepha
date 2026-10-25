import { z } from "alepha";

export const automationRunStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "skipped",
  "refused",
  "partial",
  "failed",
  "unknown",
]);
