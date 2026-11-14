import { type Infer, z } from "alepha";

/**
 * The wire format version this Lore speaks, stamped on every `welcome` so a
 * connector built against a later one can refuse rather than misread.
 */
export const HOST_PROTOCOL_VERSION = 1;

/**
 * What Lore tells a machine about itself, wire format v1 (folio #1198).
 *
 * Sent as `welcome` in answer to the machine's `hello` after every connect,
 * and again as `config` whenever one of the switches changes. The connector
 * caches it: `bay connector show` prints the slug from it, the deploy action
 * refuses when `deployAllowed` is off, and the stats gauge runs at the
 * interval it names. The CPU/RAM series switch is deliberately absent: it is
 * Lore-side only, and the machine pushes the gauge regardless.
 */
/**
 * Optional parts of the protocol this Lore takes, named on every `welcome`
 * and `config`. A machine sends a feature's frames only to a Lore that lists
 * it: `events` is the `event` frame (backups, the bucket, restores).
 */
export const HOST_FEATURES = ["events"] as const;

export const hostWelcomeFrameSchema = z.object({
  type: z.enum(["welcome", "config"]),
  protocol: z.literal(HOST_PROTOCOL_VERSION),
  /**
   * Bay wire v1: the key stays `estate`, the word Lore used before #E147.
   * Every running Bay reads it (`serverFrame` in `client.go`), and a
   * new name would need a binary swap on every host.
   */
  estate: z.object({ id: z.uuid(), slug: z.string() }),
  deployAllowed: z.boolean(),
  statsIntervalSeconds: z.integer(),
  /** Absent from an older Lore, which a machine reads as "none". */
  features: z.array(z.enum(HOST_FEATURES)).optional(),
});

export type HostWelcomeFrame = Infer<typeof hostWelcomeFrameSchema>;
