import { type Infer, z } from "alepha";

/**
 * An update check's answer when the device already runs what it should, HTTP
 * 200. The shape the pinned updater reports as `kind: "up_to_date"`.
 *
 * A device holding a downloaded bundle it has not switched to yet cancels it
 * on this answer: the server no longer wants it run (a kill switch, a
 * rollback, a rollout change).
 */
export const otaUpdateNoneSchema = z.object({
  error: z.literal("no_new_version_available"),
  message: z.text(),
  kind: z.literal("up_to_date"),
});

export type OtaUpdateNone = Infer<typeof otaUpdateNoneSchema>;
