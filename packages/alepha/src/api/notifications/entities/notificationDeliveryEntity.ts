import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * What actually happened to one notification.
 *
 * **Keyed on `executionId`, not on `messageId`.** A skipped or failed send
 * never gets a message id, and NULLs never collide in a unique index, so
 * keying on the provider's id would have deduped nothing on exactly the rows
 * that matter. `executionId` is stable across a job's retries (the job layer
 * updates one row rather than creating three), which makes one receipt per
 * notification instead of one per attempt.
 *
 * **No foreign key to `job_executions`.** The outbox row is purged after
 * `retentionDays` (7 by default) and a complaint can arrive on day 9, so the
 * receipt outlives what it points at and keeps its own 90-day clock.
 *
 * It is also the only place that maps a provider `messageId` back to an
 * `organizationId`, which is why it has to exist before bounce ingestion can.
 */
export const notificationDeliveryEntity = $entity({
  name: "notification_deliveries",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    /**
     * The job execution this receipt settles. Unique: one receipt per
     * notification, however many attempts it took.
     */
    executionId: z.text({ maxLength: 64 }),

    /**
     * Owning tenant, from the payload. Not `db.organization()`, for the same
     * reason as the suppression table: the writer runs inside a tenant-less
     * job and an auto-scoped column would read nothing.
     */
    organizationId: z.uuid().nullable().optional(),

    /**
     * The transport's id for the message, when there was one. Nullable and
     * NOT unique: only used to match inbound delivery events, never as
     * identity.
     */
    messageId: z.text({ maxLength: 255 }).nullable().optional(),

    provider: z.text({ maxLength: 64 }),
    /**
     * The delivery channel, as a plain identifier rather than an enum.
     *
     * Open on purpose: a channel is a plugin (`NotificationChannel`), so the
     * set of legal values is whatever the container registers and cannot be
     * known by a column. The boot check refuses a template naming a channel
     * nothing provides, which is what keeps a typo out of here.
     *
     * 32 rather than a bare `z.text()`: a channel name is a short
     * identifier, and 255 is the default cap.
     */
    channel: z.text({ maxLength: 32 }),
    contact: z.text({ maxLength: 320 }),
    template: z.text({ maxLength: 100 }),
    category: z.text({ maxLength: 100 }).nullable().optional(),
    critical: db.default(z.boolean(), false),

    status: z.enum([
      "sent",
      "delivered",
      "deferred",
      "bounced",
      "complained",
      "failed",
      "rejected",
      "skipped",
    ]),

    /**
     * Why the gate refused, when `status` is `skipped`.
     */
    skipReason: z.enum(["suppressed", "declined"]).nullable().optional(),

    /**
     * The rendered subject, on every non-`sensitive` receipt. Cheap, and it
     * is what makes an operator able to tell two messages apart.
     */
    subject: z.text({ maxLength: 500 }).nullable().optional(),

    /**
     * The rendered body, only when `storeRenderedBody` is on and the
     * template is not `sensitive`. Off by default: 90 days of full HTML for
     * every notification is real bytes, and a fan-out over a roster
     * multiplies it.
     */
    body: z.text().nullable().optional(),

    lastEventAt: z.datetime().nullable().optional(),
    smtpStatusCode: z.text({ maxLength: 32 }).nullable().optional(),
    error: z.text({ maxLength: 2000 }).nullable().optional(),
  }),
  indexes: [
    { columns: ["executionId"], unique: true },
    { columns: ["messageId"] },
    { columns: ["organizationId", "createdAt"] },
  ],
});

export type NotificationDeliveryEntity = Infer<
  typeof notificationDeliveryEntity.schema
>;
