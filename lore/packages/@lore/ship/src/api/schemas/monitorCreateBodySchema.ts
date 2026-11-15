import { type Infer, z } from "alepha";

import { monitorSettingsSchema } from "./monitorSettingsSchema.ts";
import { MonitorTarget } from "./MonitorTarget.ts";

/**
 * What creating a monitor takes: its settings and the app copy it belongs to
 * (#Q3657). The settings check is `monitorConfigSchema`'s, repeated because
 * a refined schema cannot be extended.
 */
export const monitorCreateBodySchema = monitorSettingsSchema
  .extend({
    /**
     * The app copy this monitor watches, which must be one of the project's.
     */
    appInstanceId: z.uuid(),
  })
  .superRefine((value, context) => {
    const error = new MonitorTarget().error(value.kind, value.target);
    if (error)
      context.addIssue({ code: "custom", path: ["target"], message: error });
    if (!value.name.trim())
      context.addIssue({
        code: "custom",
        path: ["name"],
        message: "A monitor name is required",
      });
  });
export type MonitorCreateBody = Infer<typeof monitorCreateBodySchema>;
