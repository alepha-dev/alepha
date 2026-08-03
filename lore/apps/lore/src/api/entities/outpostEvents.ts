import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { outposts } from "./outposts.ts";

/**
 * The kinds of thing a machine reports having done.
 *
 * Short on purpose. An event earns its place by changing how a chart is read —
 * a deploy explains a step in the error rate, a restart explains a gap — and
 * anything that does not is a gauge wearing a costume.
 */
export const OUTPOST_EVENT_KINDS = ["deploy", "restart"] as const;

export type OutpostEventKind = (typeof OUTPOST_EVENT_KINDS)[number];

/**
 * Something that happened on a machine, at a time.
 *
 * **This is the table the whole idea exists for.** The JSDoc on `sigils`
 * justifies its own key with the question "did the deploy break anything" — and
 * Lore could not answer it, because nothing told Lore that a deploy had
 * happened. These rows are that missing axis: they turn "the error rate tripled"
 * into "the error rate tripled ninety seconds after 1.4.2 went out", which is
 * the difference between an alert and a rollback.
 *
 * Events, not gauges, and the cost difference is the argument: one deploy is a
 * row a week per app, while a memory reading is 1440 a day. The first answers a
 * question; the second fills a disk.
 *
 * **`occurredAt` comes from the machine**, which is the only party that knows
 * when the thing happened. That makes it untrusted input — a wrong clock puts
 * an event in the wrong place on a chart — but the alternative, stamping
 * arrival time, is wrong *by construction* for anything the machine buffered
 * while Lore was unreachable.
 */
export const outpostEvents = $entity({
  name: "outpost_events",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    outpostId: db.ref(z.uuid(), () => outposts.cols.id, {
      onDelete: "cascade",
    }),
    app: z.string().min(1).max(100),
    environment: z.string().min(1).max(50),
    kind: z.enum([...OUTPOST_EVENT_KINDS]).meta({ mode: "text" }),
    /** The release involved, when the event names one. */
    release: z.string().max(100).optional(),
    /** When it happened, RFC3339, as reported by the machine. */
    occurredAt: z.string(),
    createdAt: db.createdAt(),
  }),
  indexes: [
    { columns: ["outpostId"] },
    // The read path: everything that happened to one environment, newest first.
    { columns: ["app", "environment", "occurredAt"] },
    /**
     * Idempotency, and it is load-bearing rather than tidy.
     *
     * The machine has no cursor and no memory of what it has already sent — it
     * derives its history from the release directories on disk and resends the
     * lot every minute, which is what makes it survive its own restart with no
     * state to lose. That only works if a repeat is refused here, so the
     * uniqueness is the whole delivery guarantee: at-least-once from the
     * machine, exactly-once in the table.
     */
    {
      columns: ["outpostId", "app", "environment", "kind", "occurredAt"],
      unique: true,
    },
  ],
});

export type OutpostEvent = Infer<typeof outpostEvents.schema>;
export type OutpostEventInsert = Infer<typeof outpostEvents.insertSchema>;
