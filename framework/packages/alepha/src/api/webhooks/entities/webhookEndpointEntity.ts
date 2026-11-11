import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { webhookDisabledReasonSchema } from "../schemas/webhookDisabledReasonSchema.ts";
import { webhookEndpointStatusSchema } from "../schemas/webhookEndpointStatusSchema.ts";

/**
 * A receiver of webhooks: a URL an operator registered, and the events it
 * subscribes to.
 *
 * **Endpoints are data, events are code.** Which events exist is declared
 * with `$webhook`; which URLs receive them is rows of this table. No endpoint
 * is ever declared in source.
 *
 * The signing secret is stored encrypted with the app secret (`APP_SECRET`),
 * never in clear, and both secret columns are marked `secret`, so no read of
 * the module returns them. A changed or lost `APP_SECRET` makes every one
 * unreadable: the endpoint is then disabled with reason `secret`, and a
 * rotation brings it back.
 */
export const webhookEndpointEntity = $entity({
  name: "webhook_endpoints",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    /**
     * Where the deliveries are POSTed. Never written to a log line, an error
     * column or a hook payload: it can carry a token in its query string.
     * The host is named instead.
     */
    url: z.text({ maxLength: 2048 }),
    description: z.text({ maxLength: 500 }).optional(),

    /**
     * The event names this endpoint subscribes to. Empty means every event.
     *
     * Filtered in memory over the rows selected by `status` and `scope`:
     * array operators are Postgres-only in the ORM.
     */
    events: db.default(z.array(z.text({ maxLength: 100 })), []),

    /**
     * The signing secret (`whsec_...`), encrypted with `APP_SECRET`.
     */
    secret: z.text({ maxLength: 512 }).meta({ secret: true }),

    /**
     * The secret a rotation replaced, encrypted like {@link secret}, still
     * signing beside the new one until {@link previousSecretExpiresAt}.
     */
    previousSecret: z
      .text({ maxLength: 512 })
      .meta({ secret: true })
      .optional(),

    /**
     * The first 10 characters of the current secret, in clear: enough to
     * tell two secrets apart on screen, useless to sign with.
     */
    secretPrefix: z.text({ maxLength: 10 }),
    previousSecretExpiresAt: z.datetime().optional(),

    /**
     * `active` receives events. `paused` receives no new delivery, and the
     * ones in flight wait for a resume. `disabled` was stopped by the module
     * itself (see {@link disabledReason}) and needs an operator to enable it.
     */
    status: db.default(webhookEndpointStatusSchema, "active"),
    disabledReason: webhookDisabledReasonSchema.optional(),

    /**
     * The app's own tenancy key, opaque to the module, compared for equality
     * only. An endpoint with a scope only receives events sent with that
     * scope; an unscoped one receives every event.
     */
    scope: z.text({ maxLength: 255 }).optional(),

    /**
     * The user who registered the endpoint, told when the module disables it.
     * No foreign key: the users module is optional.
     */
    createdBy: z.uuid().optional(),

    /**
     * When the current unbroken run of failures began; cleared by a success.
     */
    failingSince: z.datetime().optional(),
    lastDeliveryAt: z.datetime().optional(),
    lastSuccessAt: z.datetime().optional(),
  }),
  indexes: [{ columns: ["status"] }, { columns: ["scope"] }],
});

export type WebhookEndpointEntity = Infer<typeof webhookEndpointEntity.schema>;
