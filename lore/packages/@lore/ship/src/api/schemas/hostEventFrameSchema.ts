import { type Infer, z } from "alepha";

/**
 * Something that happened on a machine, wire format v1 with the `events`
 * feature: Bay's `connector.Event` (`internal/connector/events.go`), pinned
 * by `wire-v1/event.json`.
 *
 * An inventory says what IS and is pushed whole; an event says what HAPPENED
 * (a backup that failed at 3am, the bucket going down, a restore somebody ran
 * from the CLI). Bay spools events on disk until Lore has taken them, so the
 * same `id` can arrive twice after a reconnect: Lore keeps the first.
 *
 * Sent only to a Lore whose `welcome` lists `features: ["events"]`.
 *
 * `kind` is `<area>.<what>` (`backup.failed`, `target.down`,
 * `restore.completed`…), kept as a pattern rather than an enum so a kind Bay
 * adds later is stored and shown instead of refusing the frame (which would
 * leave it in Bay's spool forever). `app` and `env` are absent on a
 * machine-wide event, such as the bucket going down. `data` is the kind's own
 * facts, bounded by size where it is stored rather than field by field.
 */
export const hostEventFrameSchema = z.object({
  type: z.literal("event"),
  id: z.string().min(1).max(64),
  kind: z
    .string()
    .max(64)
    .regex(/^[a-z]+\.[a-z-]+$/),
  at: z.string().max(40),
  app: z.string().max(100).optional(),
  env: z.string().max(100).optional(),
  data: z.record(z.string().max(100), z.any()).optional(),
});

export type HostEventFrame = Infer<typeof hostEventFrameSchema>;
