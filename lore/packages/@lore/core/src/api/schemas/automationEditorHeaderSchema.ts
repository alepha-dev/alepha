import { z } from "alepha";

export const automationEditorHeaderSchema = z.object({
  title: z.string().min(1).max(255),
  trigger: z.enum(["event", "schedule"]),
  source: z.string(),
  guard: z.string().optional(),
  operator: z.enum([
    "eq",
    "ne",
    "lt",
    "lte",
    "gt",
    "gte",
    "delta",
    "crossesAbove",
  ]),
});
