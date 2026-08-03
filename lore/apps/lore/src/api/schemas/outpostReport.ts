import { type Infer, z } from "alepha";
import { OUTPOST_EVENT_KINDS } from "../entities/outpostEvents.ts";

/**
 * What a machine POSTs to `/outposts/report`.
 *
 * **The whole world, every time — not a delta.** The machine sends its current
 * app list and the events it can still see, and Lore replaces its snapshot from
 * it. That means the machine holds no cursor, no outbox and no memory of what
 * it has already sent, so it survives its own restart with nothing to lose and
 * nothing to reconcile. The cost is a slightly larger body once a minute; the
 * alternative is a delivery protocol on both sides and a resync path for when
 * it drifts.
 *
 * Every array is capped, and a payload over the cap is refused rather than
 * truncated: silently dropping the tail makes a sink look healthy while it
 * loses data. Fifty apps on one host is already twice what the density work
 * measured as comfortable.
 */
export const outpostReport = z.object({
  /** What the machine is running, e.g. `bay 0.25.0`. */
  agent: z.string().max(100).optional(),
  /** The base domain app subdomains are composed against. */
  baseDomain: z.string().max(253).optional(),
  apps: z
    .array(
      z.object({
        app: z.string().min(1).max(100),
        environment: z.string().min(1).max(50),
        domains: z.array(z.string().max(253)).max(20).optional(),
        release: z.string().max(100).optional(),
        running: z.boolean(),
        memoryBytes: z.integer().min(0).optional(),
        restarts: z.integer().min(0).optional(),
        lastRequestAt: z.string().max(40).optional(),
      }),
    )
    .max(50),
  /**
   * What happened, as far back as the machine can still see.
   *
   * Resent every time on purpose — the uniqueness index on
   * `(outpostId, app, environment, kind, occurredAt)` is what turns
   * at-least-once delivery into exactly-once storage. Capped at 200 because a
   * machine derives these from the releases it kept on disk, and that is
   * bounded by its own retention.
   */
  events: z
    .array(
      z.object({
        app: z.string().min(1).max(100),
        environment: z.string().min(1).max(50),
        kind: z.enum([...OUTPOST_EVENT_KINDS]).meta({ mode: "text" }),
        release: z.string().max(100).optional(),
        occurredAt: z.string().min(1).max(40),
      }),
    )
    .max(200)
    .optional(),
});

export type OutpostReport = Infer<typeof outpostReport>;
