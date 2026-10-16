import { type Infer } from "alepha";

import { monitorSettingsSchema } from "./monitorSettingsSchema.ts";
import { MonitorTarget } from "./MonitorTarget.ts";
export const monitorConfigSchema = monitorSettingsSchema.superRefine(
  (value, context) => {
    const error = new MonitorTarget().error(value.kind, value.target);
    if (error)
      context.addIssue({ code: "custom", path: ["target"], message: error });
    if (!value.name.trim())
      context.addIssue({
        code: "custom",
        path: ["name"],
        message: "A monitor name is required",
      });
  },
);
export type MonitorConfig = Infer<typeof monitorConfigSchema>;
