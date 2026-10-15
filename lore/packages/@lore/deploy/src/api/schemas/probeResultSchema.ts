import { type Infer, z } from "alepha";

export const probeResultSchema = z.object({
  ok: z.boolean(),
  result: z.enum([
    "up",
    "timeout",
    "status",
    "keyword",
    "connection",
    "cert",
    "latency",
  ]),
  latencyMs: z.integer().min(0),
  error: z.string().max(4096).optional(),
  certExpiresAt: z.string().optional(),
});

export type ProbeResult = Infer<typeof probeResultSchema>;
