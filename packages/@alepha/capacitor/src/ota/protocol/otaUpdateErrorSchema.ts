import { type Infer, z } from "alepha";

/**
 * An update check's answer when the server has nothing for this device to
 * act on. The device keeps what it runs and what it holds either way.
 *
 * - `blocked`, HTTP 200: the request was understood and refused by policy:
 *   an unknown app, platform or native build. Not "up to date", so a device
 *   never cancels a pending bundle on it.
 * - `failed`, HTTP 4xx or 5xx: a malformed request, a throttled caller, a
 *   server failure.
 */
export const otaUpdateErrorSchema = z.object({
  error: z.text({ maxLength: 64 }),
  message: z.text(),
  kind: z.enum(["blocked", "failed"]),
});

export type OtaUpdateError = Infer<typeof otaUpdateErrorSchema>;
