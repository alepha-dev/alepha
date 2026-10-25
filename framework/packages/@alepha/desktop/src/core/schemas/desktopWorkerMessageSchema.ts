import { type Infer, z } from "alepha";

/**
 * What the Worker hosting the app answers (protocol 1).
 *
 * - `ready`: configure, start and ready all ran; `origin` is the address the
 *   server actually bound, `http://127.0.0.1:<port>`;
 * - `failed`: startup or shutdown threw. `message` is the error's message
 *   only, never its stack or source excerpt;
 * - `stopped`: every stop hook finished.
 */
export const desktopWorkerMessageSchema = z.union([
  z.object({
    type: z.literal("ready"),
    version: z.literal(1),
    origin: z.string().regex(/^http:\/\/127\.0\.0\.1:\d{1,5}$/),
  }),
  z.object({
    type: z.literal("failed"),
    phase: z.enum(["start", "stop", "protocol"]),
    message: z.string(),
  }),
  z.object({
    type: z.literal("stopped"),
  }),
]);

export type DesktopWorkerMessage = Infer<typeof desktopWorkerMessageSchema>;
