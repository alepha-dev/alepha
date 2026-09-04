import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * An address the app must not send to, and why.
 *
 * One table, three reasons, two strengths. `unsubscribed` blocks
 * non-critical mail only, so a password reset still reaches someone who
 * opted out of reminders. `bounced` and `complained` block everything,
 * because continuing to mail a dead or hostile address is what costs a
 * sending domain its reputation.
 *
 * Unsubscribe links, provider events and an app's own preference screen all
 * write here, which is what lets the sender have exactly one check to make.
 */
export const notificationSuppressionEntity = $entity({
  name: "notification_suppressions",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    /**
     * Owning tenant, or null in a single-tenant app.
     *
     * Deliberately NOT `db.organization()`. That column auto-scopes every
     * query to the current request's tenant, and the sender runs inside a
     * job with no request at all, so an auto-scoped read would see nothing
     * and the gate would silently pass everyone. Same reasoning, and same
     * comment, as `job_executions.organizationId`.
     */
    organizationId: z.uuid().nullable().optional(),

    /**
     * The suppressed address or number, normalized (trimmed, lower-cased)
     * so that casing cannot walk around the gate.
     */
    contact: z.text({ maxLength: 320 }),

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

    reason: z.enum(["unsubscribed", "bounced", "complained"]),

    /**
     * The template category this applies to, or `*` for all of them.
     *
     * A sentinel rather than null, because NULLs never collide in a unique
     * index on either Postgres or SQLite: with null here, "unsubscribe from
     * everything" could be inserted again and again and the unique index
     * below would dedupe nothing.
     */
    category: db.default(z.text({ maxLength: 100 }), "*"),

    /**
     * Where the suppression came from: `link`, `cloudflare`, `brevo`,
     * `admin`, `app`. Free text on purpose, so a new writer does not need a
     * migration.
     */
    source: z.text({ maxLength: 50 }),
  }),
  indexes: [
    {
      columns: ["organizationId", "channel", "contact", "reason", "category"],
      unique: true,
    },
    { columns: ["organizationId", "channel", "contact"] },
  ],
});

export type NotificationSuppressionEntity = Infer<
  typeof notificationSuppressionEntity.schema
>;
