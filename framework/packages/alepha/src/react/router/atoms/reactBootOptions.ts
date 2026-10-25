import { $atom, type Infer, z } from "alepha";

/**
 * How a client-rendered boot treats an API it cannot reach.
 *
 * Off by default, so a website boots exactly as it always has: the first
 * transition waits for its loaders, however long they take. On (what
 * `@alepha/capacitor` does in any shell it builds), the first transition has
 * `deadline` milliseconds; when a loader's request gets no HTTP response at
 * all, or the deadline passes, the app commits its offline screen instead and
 * `ready` completes. Retry runs the transition again. A boot that hydrates
 * server HTML never uses it: the server already rendered the page.
 */
export const reactBootOptions = $atom({
  name: "alepha.react.boot.options",
  schema: z.object({
    /**
     * Commit the offline screen when the API cannot be reached at boot.
     */
    offline: z.boolean().default(false),

    /**
     * Milliseconds the first transition (loaders, session validation) may
     * take before the offline screen is committed in its place. 5000 by
     * default: half of a live updater's usual ten-second readiness window.
     */
    deadline: z.number().default(5000),
  }),
  default: {
    offline: false,
    deadline: 5000,
  },
});

export type ReactBootOptions = Infer<typeof reactBootOptions.schema>;
