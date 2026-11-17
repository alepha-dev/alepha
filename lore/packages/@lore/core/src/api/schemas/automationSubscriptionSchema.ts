import { type Infer, z } from "alepha";

/**
 * The viewer's subscription in one project, to the presets one toggle names
 * within its scope (#Q3635): one automation (#Q3808), with one source per
 * preset, each switched on or off on its own.
 */
export const automationSubscriptionSchema = z
  .object({
    /**
     * The automation is on and every event the bell names is on.
     */
    subscribed: z.boolean(),
    /**
     * The automation is on and some of its events are off: "partly on".
     */
    partial: z.boolean(),
    /** The bell's automation, when it exists. */
    automationId: z.uuid().optional(),
    /** Its revision, for the per-event switch. */
    revision: z.integer().nonnegative().optional(),
    /**
     * The channels its notifications go to (#Q3602).
     */
    channels: z.array(z.string().max(64)).max(8).optional(),
    /**
     * Each event the bell names, by preset: its title, its source node and
     * whether it is on. A bell source deleted by hand reads as off.
     */
    events: z
      .array(
        z
          .object({
            preset: z.string().max(128),
            title: z.string().max(255),
            node: z.string().max(64),
            enabled: z.boolean(),
          })
          .strict(),
      )
      .max(8),
    /**
     * Whether its author added nodes of their own on the canvas, which off
     * deletes with it.
     */
    additions: z.boolean(),
  })
  .strict();
export type AutomationSubscription = Infer<typeof automationSubscriptionSchema>;
