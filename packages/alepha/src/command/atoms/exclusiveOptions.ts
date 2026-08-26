import { $atom, type Infer, z } from "alepha";

/**
 * Options for the machine-wide exclusive command queue.
 *
 * The directory is overridable so tests can point the queue at a scratch path
 * instead of the real temp directory, which is also what lets a spawned child
 * process join the same queue as its parent.
 */
export const exclusiveOptions = $atom({
  name: "alepha.command.exclusive.options",
  description: "Machine-wide exclusive command queue options",
  schema: z.object({
    /**
     * Root directory holding the per-key queue directories.
     *
     * Defaults to a per-user directory under the system temp directory.
     */
    dir: z.text().optional(),

    /**
     * How often a waiter re-reads the queue.
     */
    pollIntervalMs: z.integer().default(2_000),

    /**
     * How often a process rewrites its own ticket to prove it is alive.
     */
    heartbeatIntervalMs: z.integer().default(5_000),

    /**
     * A ticket whose heartbeat is older than this is considered dead, and is
     * swept by whichever process notices first.
     */
    staleAfterMs: z.integer().default(15_000),

    /**
     * After waiting this long, the status line also prints the
     * ALEPHA_NO_EXCLUSIVE escape hatch, so a stuck queue is self-documenting
     * rather than silent.
     */
    hintAfterMs: z.integer().default(300_000),
  }),
  default: {
    pollIntervalMs: 2_000,
    heartbeatIntervalMs: 5_000,
    staleAfterMs: 15_000,
    hintAfterMs: 300_000,
  },
  serverOnly: true,
});

/**
 * Type for exclusive queue options.
 */
export type ExclusiveOptions = Infer<typeof exclusiveOptions.schema>;

declare module "alepha" {
  interface State {
    [exclusiveOptions.key]: ExclusiveOptions;
  }
}
